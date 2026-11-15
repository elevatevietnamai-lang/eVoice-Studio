"""Music Studio service: ACE-Step client behaviour against the documented response shapes."""
from __future__ import annotations

import asyncio
import io
import json
import sys
import tarfile
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from services import music, music_library  # noqa: E402


def _wrap(data, code=200, error=None):
    return {"data": data, "code": code, "error": error, "timestamp": 1, "extra": None}


def test_payload_never_invokes_the_language_model_unless_asked():
    p = music.build_payload(music.MusicRequest(prompt="lofi", duration=3, bpm=90))
    assert (p["thinking"], p["use_cot_caption"], p["use_cot_language"], p["use_format"]) == (False,) * 4
    assert p["batch_size"] == 1 and p["lyrics"] == "[Instrumental]"
    assert p["audio_duration"] == music.MIN_SECONDS and p["bpm"] == 90 and p["use_random_seed"] is True
    assert "lm_backend" not in p and "time_signature" not in p
    # Thinking turns on code generation only; the caption and language stay the user's own.
    t = music.build_payload(music.MusicRequest(prompt="lofi", thinking=True, time_signature="3"))
    assert (t["thinking"], t["lm_backend"], t["time_signature"]) == (True, "pt", "3")
    assert (t["use_cot_caption"], t["use_cot_language"], t["use_format"]) == (False,) * 3


def test_default_request_payload_is_unchanged():
    """Dub BGM builds a bare MusicRequest: new fields must not change what it sends."""
    assert music.build_payload(music.MusicRequest(prompt="calm piano", duration=60, bpm=80, seed=7)) == {
        "prompt": "calm piano", "lyrics": "[Instrumental]", "audio_duration": 60, "vocal_language": "en",
        "audio_format": "wav", "batch_size": 1, "inference_steps": 8, "thinking": False,
        "use_cot_caption": False, "use_cot_language": False, "use_format": False,
        "use_random_seed": False, "seed": 7, "bpm": 80,
    }


def test_every_variant_is_sent_an_explicit_seed():
    """ACE-Step draws its own seeds twice at the pinned revision (reports one, renders another), so a
    real "Reuse seed" never reproduced a random track. The backend now picks every seed itself."""
    assert music.variant_seeds(7, 1) == [7]
    seeds = music.variant_seeds(None, 3)
    assert len(seeds) == 3 and all(0 <= s <= music.MAX_SEED for s in seeds)
    assert music.variant_seeds(7, 4)[0] == 7 and len(music.variant_seeds(7, 9)) == music.MAX_BATCH
    one = music.build_payload(music.MusicRequest(prompt="x", seeds=[3912345678]))
    assert (one["use_random_seed"], one["seed"]) == (False, 3912345678)
    many = music.build_payload(music.MusicRequest(prompt="x", batch_size=2, seeds=[5, 6, 7]))
    assert (many["use_random_seed"], many["seed"]) == (False, "5,6")


def test_generate_sends_its_own_seeds_and_reports_them(tmp_path, monkeypatch):
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/release_task":
            sent.update(json.loads(request.content))
            return httpx.Response(200, json=_wrap({"task_id": "t1"}))
        if request.url.path == "/query_result":
            files = [{"file": f"/v1/audio?path={n}.wav", "status": 1, "metas": {}} for n in "ab"]
            return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 1, "result": json.dumps(files)}]))
        return httpx.Response(200, content=b"RIFF")

    engine = _mock_server(monkeypatch, handler)
    outs = [str(tmp_path / f"{n}.wav") for n in "xy"]

    async def run():
        return [e async for e in engine.generate(music.MusicRequest(prompt="x", batch_size=2), outs)]

    done = asyncio.run(run())[-1]
    seeds = [int(s) for s in sent["seed"].split(",")]
    assert sent["use_random_seed"] is False and len(seeds) == 2
    # The server reported no seed_value here: the ones we sent are what was rendered.
    assert [t["seed"] for t in done["tracks"]] == seeds


def test_key_scale_normalizes_to_acestep_form():
    assert [music.normalize_key_scale(v) for v in ("", "c", "f# MINOR", "Bbm", "E♭ major", "a min")] == [
        "", "C major", "F# minor", "Bb minor", "Eb major", "A minor"]
    for bad in ("H major", "C dorian", "C#b"):
        with pytest.raises(ValueError):
            music.normalize_key_scale(bad)


def test_result_details_keep_the_real_seed_and_lm_metadata():
    d = music.result_details({"seed_value": "12345,67890",
                              "metas": {"bpm": 96, "keyscale": "D minor", "timesignature": "3"}})
    assert d == {"seed": 12345, "bpm": 96, "key_scale": "D minor", "time_signature": "3"}
    assert music.result_details({"seed_value": "junk", "metas": {"bpm": 999}}) == {
        "seed": None, "bpm": None, "key_scale": "", "time_signature": ""}


class _Proc:
    def __init__(self):
        self.alive = True

    def poll(self):
        return None if self.alive else 0

    def terminate(self):
        self.alive = False

    def wait(self, timeout=None):
        return 0


def _fake_server(tmp_path, monkeypatch, log=""):
    from core import contained_subprocess

    monkeypatch.setattr(music, "is_installed", lambda: True)
    monkeypatch.setattr(music, "engine_dir", lambda: tmp_path)
    spawned = []

    def spawn(argv, env, **_kw):
        (tmp_path / "server.log").write_text(log, encoding="utf-8")
        spawned.append(env)
        return _Proc()

    monkeypatch.setattr(contained_subprocess, "spawn_owned", spawn)
    engine = music.AceStepEngine()

    async def healthy():
        return None

    monkeypatch.setattr(engine, "_wait_healthy", healthy)
    return engine, spawned


def test_server_mode_follows_each_request(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_CUDA_VRAM", "48")  # a debug override must never reach the engine
    log = f"[API Server] LLM model loaded: {music.LM_LARGE}\n"
    engine, spawned = _fake_server(tmp_path, monkeypatch, log=log)

    async def run():
        await engine._ensure_running(None)
        await engine._ensure_running(None)  # same mode: reused
        await engine._ensure_running(music.LM_LARGE)  # LM wanted: restarted with it
        await engine._ensure_running(None)  # a loaded LM would fill metadata: restarted without

    asyncio.run(run())
    assert [e["ACESTEP_INIT_LLM"] for e in spawned] == ["false", "true", "false"]
    lm_env = spawned[1]
    assert lm_env["ACESTEP_LM_MODEL_PATH"] == music.LM_LARGE and lm_env["ACESTEP_LM_BACKEND"] == "pt"
    assert lm_env["HF_HUB_OFFLINE"] == "1" and lm_env["ACESTEP_DOWNLOAD_SOURCE"] == "huggingface"
    # Eager init: the LM is loaded before /health answers, so the log check sees the result.
    assert lm_env["ACESTEP_NO_INIT"] == "false" and "ACESTEP_NO_INIT" not in spawned[0]
    # Any outbound fetch (HF fallback, ModelScope) fails fast; loopback still works.
    assert lm_env["HTTPS_PROXY"] == lm_env["HTTP_PROXY"] == "http://127.0.0.1:9"
    assert "127.0.0.1" in lm_env["NO_PROXY"] and spawned[0].get("HTTPS_PROXY") != "http://127.0.0.1:9"
    assert all("MAX_CUDA_VRAM" not in e for e in spawned)
    engine._kill_now()


def test_server_mode_never_switches_under_a_running_track(tmp_path, monkeypatch):
    engine, spawned = _fake_server(tmp_path, monkeypatch)

    async def run():
        await engine._ensure_running(None)
        engine._server.busy = 1
        with pytest.raises(music.MusicModeBusy):
            await engine._ensure_running(music.LM_LARGE)

    asyncio.run(run())
    assert len(spawned) == 1 and engine._alive()
    engine._server.busy = 0
    engine._kill_now()


def test_lm_that_did_not_load_as_asked_stops_the_server(tmp_path, monkeypatch):
    log = ("[API Server] Falling back to supported LM model: acestep-5Hz-lm-0.6B\n"
           "[API Server] LLM model loaded: acestep-5Hz-lm-0.6B\n")
    engine, _ = _fake_server(tmp_path, monkeypatch, log=log)
    with pytest.raises(RuntimeError, match="language model could not be loaded"):
        asyncio.run(engine._ensure_running(music.LM_LARGE))
    assert not engine._alive()


@pytest.mark.parametrize("probe,on_disk,code,model", [
    ({"large": True, "small": True}, True, None, music.LM_LARGE),
    ({"large": False, "small": True}, True, None, music.LM_SMALL),
    ({"large": False, "small": True}, False, "music_lm_missing", None),
    ({"large": False, "small": False}, True, "music_lm_unsupported", None),
])
def test_thinking_picks_the_lm_acestep_would_load(monkeypatch, probe, on_disk, code, model):
    engine = music.AceStepEngine()
    engine._probe = {"memory_gb": 12.0, "tier": "tier4", **probe}
    monkeypatch.setattr(music, "lm_on_disk", lambda _m: on_disk)
    if code:
        with pytest.raises(music.MusicLmUnavailable) as err:
            asyncio.run(engine._lm_for_request())
        assert err.value.code == code
    else:
        assert asyncio.run(engine._lm_for_request()) == model


def test_lm_probe_reads_acestep_tiering_and_hides_debug_overrides():
    assert "get_gpu_config" in music.LM_PROBE_CODE and music.LM_LARGE in music.LM_PROBE_CODE
    assert set(music._VRAM_DEBUG_ENV) == {"MAX_CUDA_VRAM", "MAX_MPS_VRAM", "MAX_XPU_VRAM"}
    compile(music.LM_PROBE_CODE, "<probe>", "exec")
    compile(music.LM_SMALL_DOWNLOAD_CODE, "<download>", "exec")
    assert len(music.LM_SMALL_REVISION) == 40


def test_generate_body_validates_language_key_and_meter():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    body = GenerateBody(prompt="x", vocal_language="VI", key_scale="f#m", time_signature="6", thinking=True)
    assert (body.vocal_language, body.key_scale, body.time_signature) == ("vi", "F# minor", "6")
    for bad in ({"vocal_language": "xx"}, {"key_scale": "C lydian"}, {"time_signature": "5"}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", **bad)


def test_unwrap_checks_code_and_error_not_just_http():
    assert music._unwrap(_wrap({"a": 1})) == {"a": 1}
    with pytest.raises(RuntimeError):
        music._unwrap(_wrap(None, code=500, error="boom"))
    with pytest.raises(RuntimeError):
        music._unwrap(_wrap({"a": 1}, error="queue full"))


def test_task_state_handles_string_and_int_statuses():
    assert [music._task_state(v) for v in ("queued", 0, 1, "1", 2)] == ["running", "running", "succeeded",
                                                                       "succeeded", "failed"]


def test_extract_refuses_path_traversal(tmp_path):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = b"x"
        for name in ("root/ok.txt", "root/../../evil.txt"):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    archive = tmp_path / "a.tar.gz"
    archive.write_bytes(buf.getvalue())
    with pytest.raises(RuntimeError):
        music._safe_extract(archive, tmp_path / "out")
    assert not (tmp_path / "evil.txt").exists()


def _tar(tmp_path, names):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in names:
            info = tarfile.TarInfo(name)
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
    archive = tmp_path / "b.tar.gz"
    archive.write_bytes(buf.getvalue())
    return archive


def test_extract_checks_hash_and_never_leaves_partial_tree(tmp_path):
    import gzip
    import hashlib
    archive = _tar(tmp_path, ["root/a.txt", "root/sub/b.txt"])
    good = hashlib.sha256(gzip.decompress(archive.read_bytes())).hexdigest()
    with pytest.raises(RuntimeError):
        music._safe_extract(archive, tmp_path / "bad", "0" * 64)
    assert not (tmp_path / "bad").exists()
    music._safe_extract(archive, tmp_path / "ok", good)
    assert (tmp_path / "ok" / "sub" / "b.txt").read_bytes() == b"x"
    assert not (tmp_path / "ok.extracting").exists()


def test_extract_caps_entry_count(tmp_path, monkeypatch):
    monkeypatch.setattr(music, "_MAX_ARCHIVE_ENTRIES", 2)
    with pytest.raises(RuntimeError):
        music._safe_extract(_tar(tmp_path, ["r/a", "r/b", "r/c"]), tmp_path / "out")


def test_download_only_follows_the_servers_own_audio_path(tmp_path):
    async def run():
        async with httpx.AsyncClient() as client:
            with pytest.raises(RuntimeError):
                await music._download(client, "http://127.0.0.1:1", "http://evil.example/x.wav", str(tmp_path / "o.wav"))
    asyncio.run(run())


def test_generate_flow_parses_stringified_result_and_saves_audio(tmp_path, monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        assert request.headers["authorization"] == "Bearer k"
        if request.url.path == "/release_task":
            return httpx.Response(200, json=_wrap({"task_id": "t1", "status": "queued", "queue_position": 1}))
        if request.url.path == "/query_result":
            result = json.dumps([{"file": "/v1/audio?path=%2Ftmp%2Fa.wav", "status": 1}])
            return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 1, "result": result}]))
        if request.url.path == "/v1/audio":
            return httpx.Response(200, content=b"RIFFdata")
        return httpx.Response(404)

    real = httpx.AsyncClient
    monkeypatch.setattr(music.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    real_sleep = asyncio.sleep
    monkeypatch.setattr(music.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    engine = music.AceStepEngine()

    async def fake_running(*_a, **_k):
        return "http://127.0.0.1:9", "k"

    monkeypatch.setattr(engine, "_ensure_running", fake_running)
    out = tmp_path / "t.wav"

    async def run():
        return [e async for e in engine.generate(music.MusicRequest(prompt="x"), str(out))]

    events = asyncio.run(run())
    assert events[-1]["type"] == "done" and out.read_bytes() == b"RIFFdata"
    assert ("POST", "/release_task") in calls and ("GET", "/v1/audio") in calls


def test_library_roundtrip_and_id_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    tid = music_library.new_id()
    music_library.audio_path(tid).write_bytes(b"x")
    music_library.save(tid, title="t")
    assert [r["id"] for r in music_library.list_tracks()] == [tid]
    assert music_library.delete(tid) and not music_library.list_tracks()
    with pytest.raises(ValueError):
        music_library.audio_path("../etc/passwd")


def test_generate_survives_a_transient_connection_error(tmp_path, monkeypatch):
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/release_task":
            return httpx.Response(200, json=_wrap({"task_id": "t1", "status": "queued"}))
        if request.url.path == "/query_result":
            state["n"] += 1
            if state["n"] == 1:
                raise httpx.ReadError("")  # empty message, as seen on a stalled server
            result = json.dumps([{"file": "/v1/audio?path=x.wav", "status": 1}])
            return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 1, "result": result}]))
        return httpx.Response(200, content=b"RIFF")

    real = httpx.AsyncClient
    monkeypatch.setattr(music.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    real_sleep = asyncio.sleep
    monkeypatch.setattr(music.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    engine = music.AceStepEngine()

    async def fake_running(*_a, **_k):
        return "http://127.0.0.1:9", "k"

    monkeypatch.setattr(engine, "_ensure_running", fake_running)

    async def run():
        return [e async for e in engine.generate(music.MusicRequest(prompt="x"), str(tmp_path / "o.wav"))]

    assert asyncio.run(run())[-1]["type"] == "done" and state["n"] == 2


def test_public_reason_hides_library_text():
    from services import music

    assert music.public_reason(RuntimeError("Music generation failed on the music server.")) == (
        "Music generation failed on the music server.")
    leaked = music.public_reason(OSError("C:/Users/secret/path"))
    assert "secret" not in leaked and "OSError" in leaked


def test_library_rejects_unknown_extension_and_caps_size(tmp_path, monkeypatch):
    from services import music_library as lib

    monkeypatch.setattr(lib, "DATA_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        lib.audio_path("0123456789ab", "exe")
    lib.save("0123456789ab", ext="../../x")
    assert lib.get("0123456789ab") is None
    monkeypatch.setattr(lib, "MAX_TRACKS", 0)
    assert lib.is_full()


def test_model_download_is_pinned_to_a_commit():
    import re

    from services import music

    assert re.fullmatch(r"[0-9a-f]{40}", music.ACESTEP_MODEL_REVISION)
    assert "revision=sys.argv[3]" in music.MODEL_DOWNLOAD_CODE
    assert "modelscope" not in music.MODEL_DOWNLOAD_CODE.lower()
    compile(music.MODEL_DOWNLOAD_CODE, "<model-download>", "exec")


def _collect(agen):
    async def run():
        return [event async for event in agen]

    return asyncio.run(run())


def test_silent_install_step_still_reports_bytes_on_disk(tmp_path):
    # uv sync and the model download print almost nothing for many minutes; the bar must move.
    target = tmp_path / "checkpoints"
    target.mkdir()

    async def silent_step():
        for size in (1000, 3000):
            await asyncio.sleep(0.05)
            (target / f"part{size}").write_bytes(b"x" * size)
        await asyncio.sleep(0.05)
        yield "Music model ready"

    events = _collect(music._watched(silent_step(), lambda: music._dir_bytes(target), stage="model",
                                     start=0.4, end=0.99, total=8000, interval=0.02))
    ticks = [event for event in events if event["type"] == "progress"]
    assert ticks and all(event["stage"] == "model" and event["total"] == 8000 for event in ticks)
    assert ticks[-1]["bytes"] == 4000
    assert 0.4 < ticks[-1]["progress"] < 0.99
    assert [event["progress"] for event in ticks] == sorted(event["progress"] for event in ticks)
    assert events[-1] == {"type": "log", "message": "Music model ready"}


def test_install_step_without_new_bytes_is_reported_as_stalled():
    async def hung_step():
        await asyncio.sleep(10)
        yield "never"

    with pytest.raises(RuntimeError, match="no progress"):
        _collect(music._watched(hung_step(), lambda: 42, stage="engine", start=0.05, end=0.4,
                                total=None, interval=0.01, stall_seconds=0.05))


def test_uv_cache_bytes_count_only_what_this_install_wrote(tmp_path):
    import os
    import time

    old = tmp_path / "archive-v0" / "old"
    old.mkdir(parents=True)
    (old / "torch.so").write_bytes(b"x" * 5000)
    past = time.time() - 3600
    os.utime(old, (past, past))
    since = time.time() - 1
    fresh = tmp_path / ".tmpAbC" / "torch"
    fresh.mkdir(parents=True)
    (fresh / "lib.dll").write_bytes(b"y" * 700)
    done = tmp_path / "archive-v0" / "new"
    done.mkdir()
    (done / "numpy.pyd").write_bytes(b"z" * 300)
    (tmp_path / ".tmpWheel").write_bytes(b"w" * 50)
    (tmp_path / ".lock").write_bytes(b"")
    assert music._new_bytes(tmp_path, since) == 1050
    assert music._new_bytes(tmp_path / "missing", since) == 0


def test_model_download_runs_without_carriage_return_progress_bars(tmp_path, monkeypatch):
    # huggingface_hub redraws its bars with \r and no newline; the line reader caps a line at
    # 64 KiB, so a 10 GB download with bars on aborted the install at the model step.
    from services import hardsub, sidecar_install

    engine = tmp_path / "acestep"
    (engine / "src").mkdir(parents=True)
    (engine / "src" / "pyproject.toml").write_text("[project]\nname='acestep'\n", encoding="utf-8")
    monkeypatch.setattr(music, "engine_dir", lambda: engine)
    monkeypatch.setattr(music, "_uv_cache_dir", lambda uv, env: tmp_path / "uv-cache")
    monkeypatch.setattr(music, "_plan_torch", lambda uv, env, src: None)
    monkeypatch.setattr(sidecar_install, "_locate_uv", lambda: "uv")
    monkeypatch.setattr(sidecar_install, "uv_subprocess_env", lambda _parent: {"PATH": "x"})
    calls = []

    async def fake_run(cmd, env, idle_timeout, cwd=None):
        calls.append((cmd, env, idle_timeout))
        yield "ok"

    monkeypatch.setattr(hardsub, "_run_logged", fake_run)
    events = _collect(music.AceStepEngine().install())
    assert events[-1] == {"type": "done", "installed": True}
    (sync, _sync_env, sync_timeout), (_model, model_env, model_timeout) = calls
    assert sync[1] == "sync"
    assert model_env["HF_HUB_DISABLE_PROGRESS_BARS"] == "1"
    # Silence alone no longer kills a slow download; the byte watcher detects stalls instead.
    assert min(sync_timeout, model_timeout) >= music._STALL_SECONDS
    stages = [event.get("stage") for event in events if event["type"] == "progress"]
    assert stages.index("engine") < stages.index("model")
    model_start = next(event for event in events if event.get("stage") == "model")
    assert model_start["total"] == music.ACESTEP_MODEL_BYTES


LOCK = """version = 1

[[package]]
name = "torch"
version = "2.10.0"
source = { registry = "https://pypi.org/simple" }
wheels = [
    { url = "https://files.example/torch-2.10.0-cp311-cp311-win_amd64.whl", hash = "sha256:%s", size = 1 },
]

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }
wheels = [
    { url = "https://download-r2.pytorch.org/whl/cu128/torch-2.7.1%%2Bcu128-cp311-cp311-manylinux_2_28_x86_64.whl", hash = "sha256:%s" },
    { url = "https://download-r2.pytorch.org/whl/cu128/torch-2.7.1%%2Bcu128-cp311-cp311-win_amd64.whl", hash = "sha256:%s" },
]
""" % ("a" * 64, "b" * 64, "c" * 64)


def test_torch_plan_follows_uv_and_the_lock():
    import re

    dry = "Would install 3 packages\n + numpy==2.1.0\n + torch==2.7.1+cu128\n + torchaudio==2.7.1+cu128\n"
    assert music._planned_version(dry, "torch") == "2.7.1+cu128"
    assert music._planned_version("Would install 1 package\n + torchaudio==2.7.1\n", "torch") is None
    windows = re.compile(r"-cp311-cp311-win_amd64\.whl$")
    wheel = music._locked_wheel(LOCK, "torch", "2.7.1+cu128", windows)
    assert wheel.filename == "torch-2.7.1+cu128-cp311-cp311-win_amd64.whl"
    assert wheel.sha256 == "c" * 64
    linux = re.compile(r"-cp311-cp311-manylinux_[0-9_]+_x86_64\.whl$")
    assert music._locked_wheel(LOCK, "torch", "2.7.1+cu128", linux).sha256 == "b" * 64
    assert music._locked_wheel(LOCK, "torch", "2.10.0", windows).sha256 == "a" * 64
    assert music._locked_wheel(LOCK, "torch", "9.9.9", windows) is None


class _Dropping(httpx.AsyncByteStream):
    """Sends part of the body, then the connection resets."""

    def __init__(self, data):
        self.data = data

    async def __aiter__(self):
        yield self.data
        raise httpx.ReadError("connection reset")


def _wheel_server(body, monkeypatch, *, drop_at):
    import hashlib

    calls = []

    def handler(request):
        rng = request.headers.get("range")
        calls.append(rng)
        start = int(rng.split("=")[1].rstrip("-")) if rng else 0
        rest = body[start:]
        headers = {"content-length": str(len(rest))}
        if rng:
            headers["content-range"] = f"bytes {start}-{len(body) - 1}/{len(body)}"
        if len(calls) == 1:
            return httpx.Response(200, headers=headers, stream=_Dropping(rest[:drop_at]))
        return httpx.Response(206 if rng else 200, headers=headers, content=rest)

    real = httpx.AsyncClient
    monkeypatch.setattr(music.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    wheel = music.LockedWheel("torch", "2.7.1", "torch-2.7.1-cp311-cp311-win_amd64.whl",
                              "https://download.example/torch.whl", hashlib.sha256(body).hexdigest())
    return wheel, calls


def test_wheel_download_resumes_after_a_connection_reset(tmp_path, monkeypatch):
    body = bytes(range(256)) * 400
    wheel, calls = _wheel_server(body, monkeypatch, drop_at=30_000)

    async def run():
        return [tick async for tick in music._download_wheel(wheel, tmp_path, interval=0, backoff=0)]

    ticks = asyncio.run(run())
    # The second request asks only for the bytes the first one did not deliver.
    assert calls == [None, "bytes=30000-"]
    assert (tmp_path / wheel.filename).read_bytes() == body
    assert not (tmp_path / (wheel.filename + ".part")).exists()
    assert ticks[-1] == (len(body), len(body))


def test_wheel_download_rejects_a_file_that_fails_its_hash_twice(tmp_path, monkeypatch):
    body = b"x" * 1000
    wheel, _calls = _wheel_server(body, monkeypatch, drop_at=1000)
    wheel = music.LockedWheel(wheel.name, wheel.version, wheel.filename, wheel.url, "0" * 64)

    async def run():
        return [tick async for tick in music._download_wheel(wheel, tmp_path, interval=0, backoff=0)]

    with pytest.raises(RuntimeError, match="does not match its locked hash"):
        asyncio.run(run())
    assert not (tmp_path / wheel.filename).exists()


def test_install_fetches_torch_resumably_and_installs_it_from_the_local_file(tmp_path, monkeypatch):
    from services import hardsub, sidecar_install

    engine = tmp_path / "acestep"
    (engine / "src").mkdir(parents=True)
    (engine / "src" / "pyproject.toml").write_text("[project]\nname='acestep'\n", encoding="utf-8")
    monkeypatch.setattr(music, "engine_dir", lambda: engine)
    monkeypatch.setattr(music, "_uv_cache_dir", lambda uv, env: None)
    monkeypatch.setattr(sidecar_install, "_locate_uv", lambda: "uv")
    monkeypatch.setattr(sidecar_install, "uv_subprocess_env", lambda _parent: {"PATH": "x"})
    wheel = music.LockedWheel("torch", "2.7.1+cu128", "torch-2.7.1+cu128-cp311-cp311-win_amd64.whl",
                              "https://download.example/torch.whl", "d" * 64)
    monkeypatch.setattr(music, "_plan_torch", lambda uv, env, src: wheel)

    async def fake_download(target, folder, **_kw):
        (folder).mkdir(parents=True, exist_ok=True)
        (folder / target.filename).write_bytes(b"wheel")
        yield 5, 10
        yield 10, 10

    monkeypatch.setattr(music, "_download_wheel", fake_download)
    calls = []

    async def fake_run(cmd, env, idle_timeout, cwd=None):
        calls.append(cmd)
        yield "ok"

    monkeypatch.setattr(hardsub, "_run_logged", fake_run)
    events = _collect(music.AceStepEngine().install())
    sync, install, _model = calls
    assert sync[-2:] == ["--no-install-package", "torch"]
    assert install[1:3] == ["pip", "install"] and "--no-index" in install
    assert install[-1] == "torch==2.7.1+cu128"
    torch_ticks = [e for e in events if e.get("stage") == "engine" and e.get("total") == 10]
    assert [e["bytes"] for e in torch_ticks] == [5, 10]
    assert not (engine / ".wheels" / wheel.filename).exists()
    assert events[-1] == {"type": "done", "installed": True}


def test_renderer_language_list_matches_the_backend():
    """The Music page offers exactly the vocal languages the backend accepts (minus 'unknown')."""
    import re

    source = (Path(__file__).resolve().parents[1] / "electron/src/renderer/src/features/music/music-options.ts")
    block = re.search(r"VOCAL_LANGUAGES = \[(.*?)\] as const", source.read_text(encoding="utf-8"), re.S)
    assert block, "VOCAL_LANGUAGES not found in music-options.ts"
    assert re.findall(r"'([a-z]+)'", block.group(1)) == [c for c in music.VOCAL_LANGUAGES if c != "unknown"]


# ── Phase 2: variants, steps, sampler, formats, Format


def test_payload_sends_variants_steps_sampler_and_format_within_bounds():
    p = music.build_payload(music.MusicRequest(prompt="x", batch_size=9, inference_steps=99,
                                               infer_method="sde", audio_format="flac"))
    assert (p["batch_size"], p["inference_steps"], p["infer_method"], p["audio_format"]) == (4, 8, "sde", "flac")
    low = music.build_payload(music.MusicRequest(prompt="x", batch_size=0, inference_steps=1, audio_format="exe"))
    assert (low["batch_size"], low["inference_steps"], low["audio_format"]) == (1, 4, "wav")
    assert "infer_method" not in low  # ODE is the server default and is never sent


def test_result_details_pick_each_variants_own_seed():
    entry = {"seed_value": "11,22,33", "metas": {}}
    assert [music.result_details(entry, i)["seed"] for i in range(4)] == [11, 22, 33, None]
    # ACE-Step draws variants after the first from 0..2**32-1 (a real batch lost such a seed).
    wide = {"seed_value": "4242, 3912345678", "metas": {}}
    assert [music.result_details(wide, i)["seed"] for i in range(2)] == [4242, 3912345678]
    assert music.result_details({"seed_value": str(2**32)}, 0)["seed"] is None


def test_result_details_drop_the_servers_not_available_metadata():
    """Turbo without Thinking reports keyscale/timesignature "N/A"; that is no key, not a key."""
    out = music.result_details({"seed_value": "1", "metas": {"keyscale": "N/A", "timesignature": "N/A", "bpm": "N/A"}})
    assert (out["key_scale"], out["time_signature"], out["bpm"]) == ("", "", None)
    lm = music.result_details({"metas": {"keyscale": "a minor", "timesignature": "3/4", "bpm": 80}})
    assert (lm["key_scale"], lm["time_signature"], lm["bpm"]) == ("A minor", "3", 80)


def test_library_cleans_not_available_metadata_saved_by_older_builds(tmp_path, monkeypatch):
    from api.routers.music import GenerateBody

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    tid = music_library.new_id()
    music_library.audio_path(tid).write_bytes(b"x")
    music_library.save(tid, title="t", key_scale="N/A", time_signature="N/A")
    record = music_library.get(tid)
    assert (record["key_scale"], record["time_signature"]) == ("", "")
    # Reusing its settings must not be refused.
    GenerateBody(prompt="x", key_scale=record["key_scale"], time_signature=record["time_signature"])
    assert GenerateBody(prompt="x", seed=music.MAX_SEED).seed == 2**32 - 1


def _mock_server(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(music.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    real_sleep = asyncio.sleep
    monkeypatch.setattr(music.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    engine = music.AceStepEngine()

    async def fake_running(*_a, **_k):
        return "http://127.0.0.1:9", "k"

    monkeypatch.setattr(engine, "_ensure_running", fake_running)
    return engine


def test_generate_saves_every_variant_with_its_seed(tmp_path, monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/release_task":
            assert json.loads(request.content)["batch_size"] == 3
            return httpx.Response(200, json=_wrap({"task_id": "t1"}))
        if request.url.path == "/query_result":
            files = [{"file": f"/v1/audio?path={n}.mp3", "status": 1, "seed_value": "5,6,7",
                      "metas": {"bpm": 100}} for n in "abc"]
            return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 1, "result": json.dumps(files)}]))
        return httpx.Response(200, content=request.url.params["path"].encode())

    engine = _mock_server(monkeypatch, handler)
    outs = [str(tmp_path / f"{n}.mp3") for n in "xyz"]

    async def run():
        return [e async for e in engine.generate(
            music.MusicRequest(prompt="x", batch_size=3, audio_format="mp3"), outs)]

    done = asyncio.run(run())[-1]
    assert [t["seed"] for t in done["tracks"]] == [5, 6, 7] and done["seed"] == 5
    assert done["key_scale"] == "" and done["bpm"] == 100
    assert [Path(p).read_bytes() for p in outs] == [b"a.mp3", b"b.mp3", b"c.mp3"]
    assert [t["path"] for t in done["tracks"]] == outs


def test_clean_format_result_checks_every_field_like_user_input():
    assert music.clean_format_result({
        "caption": "c" * 2000, "lyrics": "[verse]\nhi", "bpm": 120.0, "key_scale": "f#m",
        "time_signature": "3/4", "duration": 95.4, "vocal_language": "VI"}) == {
        "caption": "c" * 1000, "lyrics": "[verse]\nhi", "lyrics_kept": False, "bpm": 120,
        "key_scale": "F# minor", "time_signature": "3", "duration": 95, "vocal_language": "vi"}
    assert music.clean_format_result({"bpm": 900, "key_scale": "H dorian", "time_signature": "5",
                                      "duration": 9999, "vocal_language": "xx"}) == {
        "caption": "", "lyrics": "", "lyrics_kept": False, "bpm": None, "key_scale": "",
        "time_signature": "", "duration": None, "vocal_language": ""}
    assert music.clean_format_result(None)["caption"] == ""


_VI = "[Verse]\nChiều nay mưa rơi trên phố vắng\nEm đi qua những con đường quen\n[Chorus]\nAnh vẫn chờ em nơi góc phố"


def test_format_keeps_the_users_words_when_the_model_changes_them():
    # Real 0.6B outputs (2026-11-15): one run only added structure, the next garbled a line.
    arranged = ("[Intro - Piano]\n\n[Verse]\nChiều nay mưa rơi trên phố vắng\nEm đi qua những con đường quen\n\n"
                "[Chorus]\nAnh vẫn chờ em nơi góc phố.\n\n[Outro]\n[humming]\n[Chorus]\nanh vẫn  chờ em nơi góc phố")
    garbled = "[Verse]\nChiều nay mưa rơi trên phố vắng\nEm đi qua những con đường quen\n[Chorus]\nAnh vẫn chờ em объявлidì 10"
    dropped = "[Verse]\nChiều nay mưa rơi trên phố vắng\n[Chorus]\nAnh vẫn chờ em nơi góc phố"
    out = music.clean_format_result({"lyrics": arranged}, _VI)
    assert out["lyrics"] == arranged and out["lyrics_kept"] is False
    for bad in (garbled, dropped):
        out = music.clean_format_result({"lyrics": bad, "bpm": 70}, _VI)
        assert out["lyrics"] == "" and out["lyrics_kept"] is True and out["bpm"] == 70
    # With no lyrics of their own, the model may write them; empty output is never "kept".
    assert music.clean_format_result({"lyrics": garbled}, "")["lyrics"] == garbled
    assert music.clean_format_result({"lyrics": ""}, _VI)["lyrics_kept"] is False


def test_format_input_compares_with_the_users_lyrics(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_wrap({"lyrics": "[verse]\nsomething else"}))

    engine = _mock_server(monkeypatch, handler)

    async def lm():
        return music.LM_SMALL

    monkeypatch.setattr(engine, "_lm_for_request", lm)
    sung = asyncio.run(engine.format_input(music.MusicRequest(prompt="x", lyrics="la la", instrumental=False)))
    assert sung["lyrics_kept"] is True and sung["lyrics"] == ""
    engine._server.busy = 0
    inst = asyncio.run(engine.format_input(music.MusicRequest(prompt="x", lyrics="la la", instrumental=True)))
    assert inst["lyrics_kept"] is False


def test_format_input_runs_on_the_lm_server_and_returns_only_suggestions(tmp_path, monkeypatch):
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/format_input" and request.headers["authorization"] == "Bearer k"
        sent.update(json.loads(request.content))
        return httpx.Response(200, json=_wrap({"caption": "warm lofi", "lyrics": "[verse]\nla", "bpm": 82,
                                               "key_scale": "A minor", "time_signature": "4",
                                               "duration": 60, "vocal_language": "en"}))

    engine = _mock_server(monkeypatch, handler)
    asked = []

    async def lm():
        asked.append(True)
        return music.LM_SMALL

    monkeypatch.setattr(engine, "_lm_for_request", lm)
    out = asyncio.run(engine.format_input(music.MusicRequest(prompt=" lofi ", lyrics="la", instrumental=False,
                                                             bpm=80, vocal_language="en")))
    assert asked and out["caption"] == "warm lofi" and out["bpm"] == 82
    assert sent["prompt"] == "lofi" and json.loads(sent["param_obj"]) == {"duration": 60, "bpm": 80, "language": "en"}
    assert engine._server.busy == 0


def test_format_input_failure_is_our_own_message(monkeypatch):
    engine = _mock_server(monkeypatch, lambda _r: httpx.Response(200, json=_wrap(None, code=500, error="trace C:/x")))

    async def lm():
        return music.LM_SMALL

    monkeypatch.setattr(engine, "_lm_for_request", lm)
    with pytest.raises(RuntimeError) as err:
        asyncio.run(engine.format_input(music.MusicRequest(prompt="x")))
    assert "C:/x" not in str(err.value)


def test_generate_body_bounds_variants_steps_and_format():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    body = GenerateBody(prompt="x", batch_size=4, inference_steps=8, infer_method="sde", audio_format="mp3")
    req = body.to_request()
    assert (req.batch_size, req.inference_steps, req.infer_method, req.audio_format) == (4, 8, "sde", "mp3")
    # The pinned server clamps turbo to 8 steps (a real run at 20 matched 8 exactly), so more is refused.
    for bad in ({"batch_size": 5}, {"inference_steps": 3}, {"inference_steps": 9}, {"infer_method": "euler"},
                {"audio_format": "ogg"}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", **bad)


def test_saved_track_is_served_with_its_own_media_type(tmp_path, monkeypatch):
    from api.routers import music as router

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    for ext, media in (("mp3", "audio/mpeg"), ("flac", "audio/flac"), ("wav", "audio/wav")):
        tid = music_library.new_id()
        music_library.audio_path(tid, ext).write_bytes(b"x")
        music_library.save(tid, title="t", ext=ext)
        assert router.music_audio(tid).media_type == media


def test_library_counts_free_slots_for_a_batch(tmp_path, monkeypatch):
    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(music_library, "MAX_TRACKS", 3)
    tid = music_library.new_id()
    music_library.audio_path(tid).write_bytes(b"x")
    music_library.save(tid, title="t")
    assert music_library.free_slots() == 2 and not music_library.is_full()


# ── Phase 3a: cover, repaint, style reference, safe uploads


def test_cover_and_repaint_payloads_leave_text2music_untouched():
    base = music.build_payload(music.MusicRequest(prompt="x"))
    assert "task_type" not in base and "audio_cover_strength" not in base
    cover = music.build_payload(music.MusicRequest(prompt="x", task_type="cover", src_path="s.wav",
                                                   src_seconds=200.4, cover_strength=1.7))
    assert (cover["task_type"], cover["audio_cover_strength"], cover["audio_duration"]) == ("cover", 1.0, 200)
    paint = music.build_payload(music.MusicRequest(prompt="x", task_type="repaint", src_path="s.wav",
                                                   src_seconds=90, repaint_start=10, repaint_end=500,
                                                   repaint_mode="weird", repaint_strength=0.3))
    assert (paint["repainting_start"], paint["repainting_end"], paint["repaint_mode"], paint["repaint_strength"]) == (
        10.0, 90.0, "balanced", 0.3)


def test_only_edits_send_their_source_and_a_reference_rides_along():
    assert music.MusicRequest(prompt="x", src_path="s.wav").uploads() == {}
    assert music.MusicRequest(prompt="x", ref_path="r.wav").uploads() == {"ref_audio": "r.wav"}
    assert music.MusicRequest(prompt="x", task_type="cover", src_path="s.wav", ref_path="r.wav").uploads() == {
        "src_audio": "s.wav", "ref_audio": "r.wav"}


def test_release_sends_files_as_multipart_with_string_fields(tmp_path):
    src = tmp_path / "s.wav"
    src.write_bytes(b"RIFFsource")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["type"] = request.headers["content-type"]
        seen["body"] = request.content
        return httpx.Response(200, json=_wrap({"task_id": "t"}))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await music._release(client, "http://x", music.MusicRequest(
                prompt="x", task_type="cover", src_path=str(src), src_seconds=30))

    asyncio.run(run())
    assert seen["type"].startswith("multipart/form-data")
    assert b'name="src_audio"; filename="s.wav"' in seen["body"] and b"RIFFsource" in seen["body"]
    assert b'name="task_type"\r\n\r\ncover' in seen["body"] and b'name="thinking"\r\n\r\nfalse' in seen["body"]


def test_generate_body_needs_one_source_for_an_edit():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    assert GenerateBody(prompt="x", task="cover", source_track_id="0123456789ab").task == "cover"
    for bad in ({"task": "cover"}, {"source_upload_id": "0123456789ab"},
                {"task": "repaint", "source_track_id": "0123456789ab", "source_upload_id": "0123456789ab"},
                {"task": "repaint", "source_track_id": "0123456789ab", "repaint_start": 5, "repaint_end": 5},
                {"reference_track_id": "0123456789ab", "reference_upload_id": "0123456789ab"}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", **bad)


def _probe(monkeypatch, seconds):
    from services import ffmpeg_utils

    async def probe(_path, *, allowed_root):
        return seconds

    monkeypatch.setattr(ffmpeg_utils, "probe_duration", probe)


def test_sources_resolve_only_inside_the_library(tmp_path, monkeypatch):
    from api.routers.music import GenerateBody, resolve_audio

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    _probe(monkeypatch, 120.0)
    tid = music_library.new_id()
    music_library.audio_path(tid, "mp3").write_bytes(b"x")
    music_library.save(tid, title="t", ext="mp3")
    req = asyncio.run(resolve_audio(GenerateBody(prompt="x", task="repaint", source_track_id=tid,
                                                 repaint_start=10, repaint_end=20)))
    assert req.src_path == str(music_library.audio_path(tid, "mp3")) and req.src_seconds == 120.0
    for body in (GenerateBody(prompt="x", task="cover", source_track_id="../../../x"[:12]),
                 GenerateBody(prompt="x", task="cover", source_upload_id="ffffffffffff"),
                 GenerateBody(prompt="x", task="repaint", source_track_id=tid, repaint_start=130)):
        with pytest.raises(ValueError):
            asyncio.run(resolve_audio(body))
    _probe(monkeypatch, 900.0)
    with pytest.raises(ValueError, match="longer"):
        asyncio.run(resolve_audio(GenerateBody(prompt="x", task="cover", source_track_id=tid)))


def _upload_client(tmp_path, monkeypatch, seconds=30.0):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import music as router

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    _probe(monkeypatch, seconds)
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app)


def test_upload_stores_audio_under_the_library_and_returns_only_an_id(tmp_path, monkeypatch):
    client = _upload_client(tmp_path, monkeypatch)
    r = client.post("/music/upload", files={"file": ("../../song.mp3", b"ID3data", "audio/mpeg")})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"upload_id", "name", "duration"} and body["duration"] == 30.0
    stored = music_library.resolve_upload(body["upload_id"])
    assert stored.parent == music_library.uploads_dir() and stored.read_bytes() == b"ID3data"


def test_upload_rejects_other_types_unreadable_and_oversized_files(tmp_path, monkeypatch):
    client = _upload_client(tmp_path, monkeypatch, seconds=None)
    assert client.post("/music/upload", files={"file": ("x.exe", b"MZ", "application/x")}).status_code == 400
    assert client.post("/music/upload", files={"file": ("x.wav", b"junk", "audio/wav")}).status_code == 400
    monkeypatch.setattr(music_library, "MAX_UPLOAD_BYTES", 3)
    _probe(monkeypatch, 10.0)
    assert client.post("/music/upload", files={"file": ("x.wav", b"RIFFxx", "audio/wav")}).status_code == 400
    assert list(music_library.uploads_dir().iterdir()) == []


def _fake_ffmpeg(monkeypatch, calls, ok=True):
    from services import ffmpeg_utils

    async def run(cmd, timeout=0, **_k):
        calls.append(cmd)
        if ok:
            Path(cmd[-1]).write_bytes(b"fLaC")
        return (0 if ok else 1), b"", b""

    monkeypatch.setattr(ffmpeg_utils, "run_ffmpeg", run)
    monkeypatch.setattr(ffmpeg_utils, "find_ffmpeg", lambda: "ffmpeg")


def test_m4a_upload_is_stored_as_flac_the_engine_can_read(tmp_path, monkeypatch):
    """The engine's soundfile cannot open M4A: a real cover and style reference failed on one."""
    client = _upload_client(tmp_path, monkeypatch)
    calls = []
    _fake_ffmpeg(monkeypatch, calls)
    r = client.post("/music/upload", files={"file": ("song.m4a", b"ftypM4A", "audio/mp4")})
    assert r.status_code == 200
    stored = music_library.resolve_upload(r.json()["upload_id"])
    assert stored.suffix == ".flac" and stored.read_bytes() == b"fLaC"
    assert [p.suffix for p in music_library.uploads_dir().iterdir()] == [".flac"]
    assert calls[0][calls[0].index("-c:a") + 1] == "flac"
    # Engine-readable formats are stored as they are.
    r = client.post("/music/upload", files={"file": ("song.ogg", b"OggS", "audio/ogg")})
    assert music_library.resolve_upload(r.json()["upload_id"]).suffix == ".ogg" and len(calls) == 1


def test_m4a_kept_from_an_older_build_is_converted_when_used(tmp_path, monkeypatch):
    from api.routers.music import GenerateBody, resolve_audio

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    _probe(monkeypatch, 30.0)
    calls = []
    _fake_ffmpeg(monkeypatch, calls)
    music_library.upload_path("0123456789ab", "m4a").write_bytes(b"ftyp")
    req = asyncio.run(resolve_audio(GenerateBody(prompt="x", task="cover", source_upload_id="0123456789ab",
                                                 reference_upload_id="0123456789ab")))
    assert req.src_path.endswith(".flac") and req.ref_path == req.src_path and len(calls) == 1


def test_unconvertible_m4a_upload_is_refused_and_removed(tmp_path, monkeypatch):
    client = _upload_client(tmp_path, monkeypatch)
    _fake_ffmpeg(monkeypatch, [], ok=False)
    assert client.post("/music/upload", files={"file": ("x.m4a", b"junk", "audio/mp4")}).status_code == 400
    assert list(music_library.uploads_dir().iterdir()) == []


def test_old_uploads_are_pruned(tmp_path, monkeypatch):
    import os

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    for n in range(5):
        path = music_library.upload_path(f"{n:012x}", "wav")
        path.write_bytes(b"x")
        os.utime(path, (1000 + n, 1000 + n))
    music_library.prune_uploads(keep=2)
    assert sorted(p.stem for p in music_library.uploads_dir().iterdir()) == ["000000000003", "000000000004"]


# ── Phase 3b: optional SFT and base models


def test_guidance_options_are_sent_only_to_models_that_honour_them():
    turbo = music.build_payload(music.MusicRequest(prompt="x", guidance_scale=12, use_adg=True))
    assert not {"guidance_scale", "shift", "use_adg", "cfg_interval_start"} & set(turbo)
    sft = music.build_payload(music.MusicRequest(prompt="x", model="sft", inference_steps=99, guidance_scale=40,
                                                 shift=0.2, use_adg=True, cfg_interval_start=0.6,
                                                 cfg_interval_end=0.3))
    assert (sft["inference_steps"], sft["guidance_scale"], sft["shift"], sft["use_adg"]) == (64, 15.0, 1.0, True)
    assert (sft["cfg_interval_start"], sft["cfg_interval_end"]) == (0.6, 0.6)
    assert music.build_payload(music.MusicRequest(prompt="x", model="base", inference_steps=4))["inference_steps"] == 8


def test_optional_models_are_pinned_downloads():
    for key in ("sft", "base"):
        spec = music.DIT_MODELS[key]
        assert len(spec["revision"]) == 40 and spec["repo"].startswith("ACE-Step/") and spec["bytes"] > 4e9
    compile(music.DIT_DOWNLOAD_CODE, "<dit>", "exec")
    assert music.DIT_MODELS["turbo"]["repo"] is None


def test_server_loads_the_chosen_model_offline_and_switches_when_asked(tmp_path, monkeypatch):
    engine, spawned = _fake_server(tmp_path, monkeypatch)
    monkeypatch.setattr(music, "dit_on_disk", lambda m: True)

    async def run():
        await engine._ensure_running(None)
        await engine._ensure_running(None, "sft")
        await engine._ensure_running(None, "sft")

    asyncio.run(run())
    assert len(spawned) == 2 and "ACESTEP_CONFIG_PATH" not in spawned[0]
    assert spawned[1]["ACESTEP_CONFIG_PATH"] == "acestep-v15-sft" and spawned[1]["HF_HUB_OFFLINE"] == "1"
    assert spawned[1]["HTTPS_PROXY"] == "http://127.0.0.1:9" and spawned[1]["ACESTEP_INIT_LLM"] == "false"
    engine._kill_now()


def test_a_model_that_is_not_downloaded_is_refused_before_starting(tmp_path, monkeypatch):
    engine, spawned = _fake_server(tmp_path, monkeypatch)
    monkeypatch.setattr(music, "checkpoints_dir", lambda: tmp_path / "ckpt")
    with pytest.raises(music.MusicLmUnavailable) as err:
        asyncio.run(engine._ensure_running(None, "base"))
    assert err.value.code == "music_model_missing" and spawned == []
    assert [m["id"] for m in engine.models_status() if not m["installed"]] == ["sft", "base"]


def test_generate_body_checks_steps_per_model():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    assert GenerateBody(prompt="x", model="sft", inference_steps=48).to_request().model == "sft"
    for bad in ({"inference_steps": 32}, {"model": "base", "inference_steps": 6},
                {"model": "sft", "cfg_interval_start": 0.8, "cfg_interval_end": 0.2},
                {"model": "xl"}, {"model": "sft", "guidance_scale": 30}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", **bad)


def test_renderer_model_table_matches_the_backend():
    """music-options.ts mirrors each model's step range and whether it takes guidance."""
    import re

    source = (Path(__file__).resolve().parents[1] / "electron/src/renderer/src/features/music/music-options.ts"
              ).read_text(encoding="utf-8")
    for key, spec in music.DIT_MODELS.items():
        row = re.search(rf"{key}: \{{ steps: \[(\d+), (\d+), (\d+)\], guidance: (true|false)", source)
        assert row, f"{key} missing from DIT_MODELS in music-options.ts"
        assert tuple(int(v) for v in row.groups()[:3]) == spec["steps"]
        assert (row.group(4) == "true") == spec["guidance"]


# ── Phase 3c: extend and the language model's sampling options


def test_extend_after_the_end_pads_and_regenerates_the_join():
    """Checked on the pinned engine: a repaint past the source's end keeps it intact and fills the rest."""
    p = music.build_payload(music.MusicRequest(prompt="x", task_type="extend", src_path="s.wav", src_seconds=40,
                                               extend_seconds=20, extend_overlap=2))
    assert (p["task_type"], p["repainting_start"], p["repainting_end"], p["audio_duration"]) == (
        "repaint", 38.0, 60.0, 60)
    assert p["repaint_mode"] == "balanced" and "audio_cover_strength" not in p


def test_extend_before_the_start_uses_a_negative_start():
    p = music.build_payload(music.MusicRequest(prompt="x", task_type="extend", src_path="s.wav", src_seconds=40,
                                               extend_side="start", extend_seconds=15, extend_overlap=2,
                                               repaint_mode="conservative"))
    assert (p["repainting_start"], p["repainting_end"], p["audio_duration"], p["repaint_mode"]) == (
        -15.0, 2.0, 55, "conservative")
    # Values out of range are clamped, never sent as they came.
    wild = music.build_payload(music.MusicRequest(prompt="x", task_type="extend", src_path="s.wav", src_seconds=3,
                                                  extend_seconds=999, extend_overlap=50))
    assert (wild["repainting_start"], wild["repainting_end"]) == (0.0, 123.0)
    assert music.MusicRequest(prompt="x", task_type="extend", src_path="s.wav").uploads() == {"src_audio": "s.wav"}


def test_extend_body_needs_a_source_and_fits_the_length_limit(tmp_path, monkeypatch):
    from pydantic import ValidationError
    from api.routers.music import GenerateBody, resolve_audio

    with pytest.raises(ValidationError):
        GenerateBody(prompt="x", task="extend")
    for bad in ({"extend_seconds": 4}, {"extend_seconds": 121}, {"extend_overlap": 11}, {"extend_side": "middle"}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", task="extend", source_track_id="0123456789ab", **bad)
    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    tid = music_library.new_id()
    music_library.audio_path(tid).write_bytes(b"x")
    music_library.save(tid, title="t")
    _probe(monkeypatch, 590.0)
    with pytest.raises(ValueError, match="longer than 10 minutes"):
        asyncio.run(resolve_audio(GenerateBody(prompt="x", task="extend", source_track_id=tid, extend_seconds=30)))
    _probe(monkeypatch, 100.0)
    req = asyncio.run(resolve_audio(GenerateBody(prompt="x", task="extend", source_track_id=tid, extend_seconds=30)))
    assert req.seconds() == 130 and req.task_type == "extend"


def test_lm_options_are_sent_only_with_thinking_and_only_when_set():
    from api.routers.music import GenerateBody

    plain = music.build_payload(GenerateBody(prompt="x", lm_temperature=1.2).to_request())
    assert not any(k.startswith("lm_") for k in plain)
    think = music.build_payload(GenerateBody(prompt="x", thinking=True).to_request())
    assert [k for k in think if k.startswith("lm_")] == ["lm_backend"]
    tuned = music.build_payload(GenerateBody(prompt="x", thinking=True, lm_temperature=1.2, lm_top_k=40,
                                             lm_negative_prompt=" no drums ").to_request())
    assert (tuned["lm_temperature"], tuned["lm_top_k"], tuned["lm_negative_prompt"]) == (1.2, 40, "no drums")
    assert "lm_cfg_scale" not in tuned and "lm_top_p" not in tuned
    same = music.build_payload(GenerateBody(prompt="x", thinking=True,
                                            lm_negative_prompt=music.LM_NEGATIVE_PROMPT_DEFAULT).to_request())
    assert "lm_negative_prompt" not in same


def test_lm_options_are_bounded_like_the_server_defaults_say():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    for name, (low, high, default) in music.LM_PARAMS.items():
        assert default is None or low <= default <= high
        for bad in (low - 1, high + 1):
            with pytest.raises(ValidationError):
                GenerateBody(prompt="x", **{name: bad})
    with pytest.raises(ValidationError):
        GenerateBody(prompt="x", lm_negative_prompt="n" * 501)


def test_renderer_extend_and_lm_tables_match_the_backend():
    """music-options.ts mirrors the extend ranges and the language-model option table."""
    import re

    source = (Path(__file__).resolve().parents[1] / "electron/src/renderer/src/features/music/music-options.ts"
              ).read_text(encoding="utf-8")

    def nums(text):
        return tuple(None if v == "null" else float(v) for v in re.findall(r"-?[\d.]+|null", text))

    for name, spec in (("EXTEND_SECONDS", music.EXTEND_SECONDS), ("EXTEND_OVERLAP", music.EXTEND_OVERLAP)):
        row = re.search(rf"export const {name} = \[([^\]]+)\]", source)
        assert row and nums(row.group(1)) == tuple(float(v) for v in spec), name
    for name, spec in music.LM_PARAMS.items():
        row = re.search(rf"{name}: \{{ range: \[([^\]]+)\]", source)
        assert row, f"{name} missing from LM_PARAMS in music-options.ts"
        assert nums(row.group(1)) == tuple(None if v is None else float(v) for v in spec), name
    assert f"LM_NEGATIVE_PROMPT_DEFAULT = '{music.LM_NEGATIVE_PROMPT_DEFAULT}'" in source


# ── Phase 4a: LoRA picked in the desktop app


def _lora_grant(tmp_path, monkeypatch, path):
    """What Electron main writes after its native picker: a one-shot grant, the backend sees a token."""
    from core import path_authorization

    store = tmp_path / ".path-authorizations"
    store.mkdir(exist_ok=True)
    token = "ab" * 32
    (store / f"{token}.json").write_text(json.dumps({"token": token, "kind": "music_lora", "path": str(path)}),
                                         encoding="utf-8")
    monkeypatch.setattr(path_authorization, "_AUTH_DIR", str(store))
    return token


def _lora_client(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import music as router

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(router.router)
    return TestClient(app, client=("127.0.0.1", 5000))


def test_lora_kind_accepts_only_what_the_engine_loads(tmp_path):
    (tmp_path / "a.safetensors").write_bytes(b"x")
    (tmp_path / "peft").mkdir()
    (tmp_path / "peft" / "adapter_config.json").write_text("{}")
    (tmp_path / "lokr").mkdir()
    (tmp_path / "lokr" / "lokr_weights.safetensors").write_bytes(b"x")
    (tmp_path / "empty").mkdir()
    (tmp_path / "x.bin").write_bytes(b"x")
    assert [music.lora_kind(str(tmp_path / n)) for n in ("a.safetensors", "peft", "lokr")] == [
        "file", "folder", "folder"]
    for bad in ("empty", "x.bin", "missing.safetensors"):
        with pytest.raises(ValueError):
            music.lora_kind(str(tmp_path / bad))


def test_lora_is_chosen_only_through_a_desktop_grant_never_a_path(tmp_path, monkeypatch):
    client = _lora_client(tmp_path, monkeypatch)
    lora = tmp_path / "style.safetensors"
    lora.write_bytes(b"x")
    # A raw path in place of the grant is refused by validation; an unknown token by the grant store.
    assert client.post("/music/lora", json={"authorization": str(lora)}).status_code == 422
    _lora_grant(tmp_path, monkeypatch, lora)
    assert client.post("/music/lora", json={"authorization": "cd" * 32}).status_code == 403
    token = _lora_grant(tmp_path, monkeypatch, lora)
    r = client.post("/music/lora", json={"authorization": token, "model": "sft"})
    assert r.status_code == 200
    view = r.json()
    assert view == {"selected": True, "name": "style.safetensors", "kind": "file", "scale": 1.0,
                    "enabled": True, "model": "sft", "available": True}
    assert "path" not in client.get("/music/lora").json()
    # The grant is one-shot.
    assert client.post("/music/lora", json={"authorization": token}).status_code == 403
    assert client.patch("/music/lora", json={"scale": 0.4, "enabled": False}).json()["scale"] == 0.4
    assert client.patch("/music/lora", json={"scale": 1.5}).status_code == 422
    assert client.delete("/music/lora").json() == {"selected": False}
    assert client.get("/music/lora").json() == {"selected": False}


def test_lora_routes_that_change_it_need_the_desktop(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import music as router

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(router.router)
    remote = TestClient(app, client=("203.0.113.9", 5000))
    assert remote.post("/music/lora", json={"authorization": "ab" * 32}).status_code == 403
    for route in router.router.routes:
        if getattr(route, "path", "") == "/music/lora" and "POST" in route.methods:
            names = {d.call.__name__ for d in route.dependant.dependencies}
            assert {"require_admin", "require_desktop"} <= names


def test_generate_uses_the_lora_only_while_it_is_on_and_on_disk(tmp_path, monkeypatch):
    from api.routers.music import _apply_lora_choice

    monkeypatch.setattr(music_library, "DATA_DIR", str(tmp_path))
    lora = tmp_path / "style.safetensors"
    lora.write_bytes(b"x")
    music_library.save_lora({"path": str(lora), "name": "style.safetensors", "scale": 0.6, "enabled": True})
    req = music.MusicRequest(prompt="x")
    assert _apply_lora_choice(req) == {"name": "style.safetensors", "scale": 0.6}
    assert (req.lora_path, req.lora_scale) == (str(lora), 0.6)
    music_library.save_lora({"path": str(lora), "scale": 0.6, "enabled": False})
    off = music.MusicRequest(prompt="x")
    assert _apply_lora_choice(off) is None and off.lora_path is None
    music_library.save_lora({"path": str(tmp_path / "gone.safetensors"), "enabled": True})
    with pytest.raises(ValueError, match="moved or deleted"):
        _apply_lora_choice(music.MusicRequest(prompt="x"))


def test_engine_loads_swaps_and_unloads_the_lora_on_its_server(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.url.path, json.loads(request.content or b"{}")))
        return httpx.Response(200, json=_wrap({"message": "ok"}))

    engine = _mock_server(monkeypatch, handler)

    async def run(req):
        async with httpx.AsyncClient() as client:
            await engine._apply_lora(client, "http://x", req)

    asyncio.run(run(music.MusicRequest(prompt="x", lora_path="/a", lora_scale=0.5)))
    asyncio.run(run(music.MusicRequest(prompt="x", lora_path="/a", lora_scale=0.7)))
    asyncio.run(run(music.MusicRequest(prompt="x", lora_path="/b")))
    asyncio.run(run(music.MusicRequest(prompt="x")))
    assert [c[0] for c in calls] == [
        "/v1/lora/load", "/v1/lora/scale", "/v1/lora/toggle",
        "/v1/lora/scale", "/v1/lora/toggle",
        "/v1/lora/unload", "/v1/lora/load", "/v1/lora/scale", "/v1/lora/toggle",
        "/v1/lora/unload"]
    assert calls[0][1] == {"lora_path": "/a"} and calls[1][1] == {"scale": 0.5}
    assert engine._server.lora is None


def test_lora_failure_does_not_leak_the_servers_text(monkeypatch):
    engine = _mock_server(monkeypatch, lambda _r: httpx.Response(400, json={"detail": "LoRA path not found: C:/secret"}))

    async def run():
        async with httpx.AsyncClient() as client:
            await engine._apply_lora(client, "http://x", music.MusicRequest(prompt="x", lora_path="/a"))

    with pytest.raises(RuntimeError) as err:
        asyncio.run(run())
    assert "secret" not in str(err.value) and engine._server.lora is None


def test_a_lora_starts_the_server_with_the_model_loaded(tmp_path, monkeypatch):
    engine, spawned = _fake_server(tmp_path, monkeypatch)

    async def run():
        await engine._ensure_running(None)
        await engine._ensure_running(None, eager=True)
        await engine._ensure_running(None)  # an eager server serves plain requests too

    asyncio.run(run())
    assert len(spawned) == 2 and "ACESTEP_NO_INIT" not in spawned[0]
    assert spawned[1]["ACESTEP_NO_INIT"] == "false"
    engine._kill_now()


# ── Phase 4b: Base-only stem tasks


def test_stem_tasks_send_their_instruments_and_nothing_for_other_tasks():
    ex = music.build_payload(music.MusicRequest(prompt="x", model="base", task_type="extract", src_path="s.wav",
                                                src_seconds=30, track_name="vocals"))
    assert (ex["task_type"], ex["track_name"], ex["audio_duration"]) == ("extract", "vocals", 30)
    assert "repainting_start" not in ex and "global_caption" not in ex
    lego = music.build_payload(music.MusicRequest(prompt="warm bass line", model="base", task_type="lego",
                                                  src_path="s.wav", src_seconds=30, track_name="bass",
                                                  global_caption=" lo-fi hip hop "))
    assert (lego["task_type"], lego["track_name"], lego["global_caption"]) == ("lego", "bass", "lo-fi hip hop")
    done = music.build_payload(music.MusicRequest(prompt="x", model="base", task_type="complete", src_path="s.wav",
                                                  src_seconds=30, track_classes=["drums", "evil", "bass"]))
    # Unknown names are dropped and the server's own order is kept.
    assert done["track_classes"] == ["bass", "drums"] and "track_name" not in done
    plain = music.build_payload(music.MusicRequest(prompt="x", track_name="vocals", global_caption="y"))
    assert not {"track_name", "track_classes", "global_caption", "task_type"} & set(plain)
    assert music.MusicRequest(prompt="x", task_type="lego", src_path="s.wav").uploads() == {"src_audio": "s.wav"}


def test_track_classes_go_out_as_one_multipart_field_each(tmp_path):
    src = tmp_path / "s.wav"
    src.write_bytes(b"RIFF")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json=_wrap({"task_id": "t"}))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await music._release(client, "http://x", music.MusicRequest(
                prompt="x", model="base", task_type="complete", src_path=str(src), src_seconds=30,
                track_classes=["drums", "bass"]))

    asyncio.run(run())
    body = seen["body"]
    assert body.count(b'name="track_classes"') == 2
    assert b'name="track_classes"\r\n\r\nbass' in body and b'name="track_classes"\r\n\r\ndrums' in body


def test_stem_tasks_need_the_base_model_and_known_instruments():
    from pydantic import ValidationError
    from api.routers.music import GenerateBody

    src = {"source_track_id": "0123456789ab"}
    ok = GenerateBody(prompt="x", task="extract", model="base", track_name="vocals", inference_steps=32, **src)
    assert ok.to_request().track_name == "vocals"
    GenerateBody(prompt="x", task="complete", model="base", track_classes=["bass", "drums"], inference_steps=32, **src)
    for bad in ({"task": "extract", "model": "sft", "track_name": "vocals", "inference_steps": 32},
                {"task": "extract", "track_name": "vocals"},
                {"task": "lego", "model": "base", "track_name": "kazoo", "inference_steps": 32},
                {"task": "complete", "model": "base", "inference_steps": 32},
                {"task": "complete", "model": "base", "track_classes": ["bass", "kazoo"], "inference_steps": 32},
                {"task": "extract", "model": "base", "track_name": "vocals", "inference_steps": 32,
                 "source_track_id": None}):
        with pytest.raises(ValidationError):
            GenerateBody(prompt="x", **{**src, **bad})


def test_renderer_track_list_matches_the_backend():
    import re

    source = (Path(__file__).resolve().parents[1] / "electron/src/renderer/src/features/music/music-options.ts"
              ).read_text(encoding="utf-8")
    block = re.search(r"TRACK_NAMES = \[(.*?)\] as const", source, re.S)
    assert block, "TRACK_NAMES not found in music-options.ts"
    assert tuple(re.findall(r"'([a-z_]+)'", block.group(1))) == music.TRACK_NAMES
