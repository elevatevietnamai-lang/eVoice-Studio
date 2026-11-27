"""Image sources: off by default, preview-then-generate, fake CLIs, jobs and provenance.

No real CLI or network is used: Codex and Antigravity are small Python scripts
that behave like the real tools (prompt on stdin, image written to the work
folder / the conversation's brain folder), ComfyUI and the OpenAI-style API are
stubbed at their transport.
"""

from __future__ import annotations

import io
import json
import os
import sys
import textwrap
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _png_bytes(size=(96, 96)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", size, (10, 200, 30, 255)).save(buf, "PNG")
    return buf.getvalue()


FAKE_CODEX = textwrap.dedent("""
    import io, os, sys, json
    from PIL import Image
    args = sys.argv[1:]
    prompt = sys.stdin.read()
    workdir = args[args.index("-C") + 1]
    assert args[:2] == ["exec", "--skip-git-repo-check"], args
    images = args[args.index("-i") + 1:] if "-i" in args else []
    with open(os.path.join(workdir, "..", "seen.json"), "w") as f:
        json.dump({"args": args, "prompt": prompt, "images": images}, f)
    if "FAIL" in prompt:
        sys.exit(3)
    if "NOTHING" in prompt:
        sys.exit(0)
    Image.new("RGB", (120, 80), (1, 2, 3)).save(os.path.join(workdir, "out.png"))
""")

FAKE_AGY = textwrap.dedent("""
    import json, sys
    line = sys.stdin.readline()
    msg = json.loads(line)
    assert msg["event"] == "user"
    conv = "050b3405-a440-4ea9-9ced-de759eed41df"
    print(json.dumps({"event": "init", "conversation_id": conv}), flush=True)
    print(json.dumps({"event": "result", "result": {"conversation_id": conv, "status": "SUCCESS"}}), flush=True)
""")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from core import config, prefs
    from services.image_sources import adapters, cli, config as cfgmod

    monkeypatch.setattr(config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "OUTPUTS_DIR", str(tmp_path / "outputs"))
    store: dict = {}
    monkeypatch.setattr(prefs, "get", lambda key, default=None: store.get(key, default))
    monkeypatch.setattr(prefs, "set_", lambda key, value: store.__setitem__(key, value))
    secrets: dict = {}
    monkeypatch.setattr(cfgmod, "openai_key", lambda: secrets.get("k"))
    monkeypatch.setattr(cfgmod, "set_openai_key", lambda v: secrets.__setitem__("k", v))
    monkeypatch.setattr(adapters, "openai_key", lambda: secrets.get("k"))
    monkeypatch.setattr(adapters, "POLL_SECONDS", 0.05)
    codex = tmp_path / "fake_codex.py"
    codex.write_text(FAKE_CODEX)
    agy = tmp_path / "fake_agy.py"
    agy.write_text(FAKE_AGY)
    monkeypatch.setattr(cli, "COMMAND_OVERRIDES", {"codex": [sys.executable, str(codex)],
                                                   "agy": [sys.executable, str(agy)]})
    brain = tmp_path / "brain"
    monkeypatch.setattr(adapters, "AGY_BRAIN_ROOT", str(brain))
    from api.routers import images

    app = FastAPI()
    app.include_router(images.router)
    return {"client": TestClient(app), "tmp": tmp_path, "brain": brain, "store": store}


def _wait(client, job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/images/jobs/{job_id}").json()
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_off_by_default_and_nothing_runs(env, monkeypatch):
    from services.image_sources import adapters

    calls = []
    monkeypatch.setattr(adapters, "_run_cli", lambda *a, **k: calls.append(a))
    client = env["client"]
    state = client.get("/images/sources").json()
    assert state["active"] == "off"
    assert client.post("/images/preview", json={"prompt": "a fox"}).json()["detail"] == "images:off"
    r = client.post("/images/generate", json={"source_id": "codex", "prompt": "a fox"})
    assert r.status_code == 409 and r.json()["detail"] == "images:off"
    assert calls == []


def test_codex_preview_then_generate(env):
    client = env["client"]
    assert client.put("/images/sources", json={"active": "codex"}).json()["active"] == "codex"
    preview = client.post("/images/preview", json={"prompt": "a fox", "transparent": True}).json()
    assert preview["source_id"] == "codex" and preview["destination"] == "OpenAI"
    assert "transparent" in preview["prompt"] and "a fox" in preview["prompt"]
    job = client.post("/images/generate", json={"source_id": "codex", "prompt": preview["prompt"],
                                                "transparent": True}).json()
    done = _wait(client, job["job_id"])
    assert done["status"] == "done", done
    media = done["media"]
    assert media["id"].endswith(".png") and media["width"] == 120
    assert media["provenance"]["prompt"] == preview["prompt"]
    assert media["provenance"]["ai_generated"] is True and media["provenance"]["source"] == "codex"
    stored = env["tmp"] / "outputs" / "promo_media" / media["id"]
    assert stored.is_file()
    library = client.get("/images/library").json()["images"]
    assert [i["id"] for i in library] == [media["id"]]


def test_codex_receives_references_and_exact_prompt(env):
    client = env["client"]
    client.put("/images/sources", json={"active": "codex"})
    media_dir = env["tmp"] / "outputs" / "promo_media"
    media_dir.mkdir(parents=True, exist_ok=True)
    (media_dir / "0123456789abcdef.png").write_bytes(_png_bytes())
    preview = client.post("/images/preview", json={"prompt": "hero",
                                                   "reference_media_ids": ["0123456789abcdef.png"]}).json()
    assert preview["references"][0]["url"] == "/audio/promo_media/0123456789abcdef.png"
    job = client.post("/images/generate", json={
        "source_id": "codex", "prompt": preview["prompt"],
        "reference_media_ids": ["0123456789abcdef.png"]}).json()
    assert _wait(client, job["job_id"])["status"] == "done"


def test_source_change_between_preview_and_generate_is_refused(env):
    client = env["client"]
    client.put("/images/sources", json={"active": "codex"})
    preview = client.post("/images/preview", json={"prompt": "x"}).json()
    client.put("/images/sources", json={"active": "agy"})
    r = client.post("/images/generate", json={"source_id": "codex", "prompt": preview["prompt"]})
    assert r.json()["detail"] == "images:source_changed"


@pytest.mark.parametrize("word,code", [("FAIL", "cli_failed"), ("NOTHING", "no_image")])
def test_codex_failures(env, word, code):
    client = env["client"]
    client.put("/images/sources", json={"active": "codex"})
    job = client.post("/images/generate", json={"source_id": "codex", "prompt": word}).json()
    done = _wait(client, job["job_id"])
    assert (done["status"], done["error"]) == ("failed", code)


def test_agy_waits_for_late_image_in_brain(env):
    client = env["client"]
    client.put("/images/sources", json={"active": "agy"})
    folder = env["brain"] / "050b3405-a440-4ea9-9ced-de759eed41df"

    def late():  # the CLI exits before its subagent writes the image
        time.sleep(1.5)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "fox_1.jpg").write_bytes(_jpeg())

    threading.Thread(target=late, daemon=True).start()
    job = client.post("/images/generate", json={"source_id": "agy", "prompt": "fox"}).json()
    done = _wait(client, job["job_id"])
    assert done["status"] == "done", done
    assert done["media"]["id"].endswith(".jpg")


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (100, 100), (200, 100, 0)).save(buf, "JPEG")
    return buf.getvalue()


def test_cancel_stops_job(env, monkeypatch):
    from services.image_sources import adapters

    monkeypatch.setattr(adapters, "AGY_BRAIN_WAIT", 60)
    client = env["client"]
    client.put("/images/sources", json={"active": "agy"})
    job = client.post("/images/generate", json={"source_id": "agy", "prompt": "never"}).json()
    time.sleep(1.0)
    client.post(f"/images/jobs/{job['job_id']}/cancel")
    assert _wait(client, job["job_id"])["status"] == "cancelled"


def test_bad_image_is_rejected(env, monkeypatch):
    from services.image_sources import adapters

    def bogus(req, cfg, ctx):
        path = os.path.join(req.workdir, "x.png")
        with open(path, "wb") as f:
            f.write(b"\x89PNG not really")
        return path

    monkeypatch.setattr(adapters, "run", bogus)
    client = env["client"]
    client.put("/images/sources", json={"active": "codex"})
    job = client.post("/images/generate", json={"source_id": "codex", "prompt": "x"}).json()
    assert _wait(client, job["job_id"])["error"] == "bad_image"


def test_comfyui_workflow_gets_prompt(env, monkeypatch):
    from services.image_sources import adapters

    sent = {}

    def fake(cfg, method, path, *, query="", body=None, timeout=30.0):
        if path == "prompt":
            sent["graph"] = body["prompt"]
            return json.dumps({"prompt_id": "11111111-2222-3333-4444-555555555555"}).encode()
        if path.startswith("history/"):
            return json.dumps({"11111111-2222-3333-4444-555555555555": {"outputs": {"9": {"images": [
                {"filename": "a.png", "subfolder": "", "type": "output"}]}}}}).encode()
        if path == "view":
            return _png_bytes()
        raise AssertionError(path)

    monkeypatch.setattr(adapters, "_comfy", fake)
    client = env["client"]
    wf = json.dumps({"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}"}}})
    state = client.put("/images/sources", json={"active": "comfyui", "comfyui_workflow": wf}).json()
    assert next(s for s in state["sources"] if s["id"] == "comfyui")["available"]
    preview = client.post("/images/preview", json={"prompt": "cat"}).json()
    assert preview["local"] is True and "save it as a PNG" not in preview["prompt"]
    job = client.post("/images/generate", json={"source_id": "comfyui", "prompt": preview["prompt"]}).json()
    assert _wait(client, job["job_id"])["status"] == "done"
    assert sent["graph"]["6"]["inputs"]["text"] == preview["prompt"]


def test_openai_key_is_never_returned(env, monkeypatch):
    client = env["client"]
    state = client.put("/images/sources", json={"active": "openai", "openai_key": "sk-secret"}).json()
    assert "sk-secret" not in json.dumps(state) and state["settings"]["openai_key_set"] is True
    r = client.put("/images/sources", json={"active": "openai", "openai_base_url": "http://example.com/v1"})
    assert r.json()["detail"] == "images:base_url"


def test_kit_style_goes_into_the_prompt(env, monkeypatch):
    from services import channel_kit as ck

    kit = ck.create(ck.KitBody(name="K", identity={"image_style": "flat pastel", "palette": [
        {"name": "Coral", "hex": "#ff7f50"}]}, characters=[{"id": "fox", "name": "Foxy",
                                                            "appearance": "orange fox, green scarf"}]))
    client = env["client"]
    client.put("/images/sources", json={"active": "codex"})
    p = client.post("/images/preview", json={"prompt": "waving", "kit_id": kit.id,
                                             "character_id": "fox"}).json()["prompt"]
    assert "flat pastel" in p and "Coral #ff7f50" in p and "Foxy, orange fox, green scarf" in p


def test_windows_shim_is_resolved_without_cmd(tmp_path, monkeypatch):
    from services.image_sources import cli

    script = tmp_path / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
    script.parent.mkdir(parents=True)
    script.write_text("")
    shim = tmp_path / "codex.cmd"
    shim.write_text('IF EXIST "%dp0%\\node.exe" (\r\n SET "_prog=%dp0%\\node.exe"\r\n)\r\n'
                    '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n')
    monkeypatch.setattr(cli.shutil, "which", lambda name: "/usr/bin/node" if name == "node" else None)
    assert cli._from_shim(str(shim)) == ["/usr/bin/node", os.path.normpath(str(script))]
