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


def test_payload_never_invokes_the_language_model():
    p = music.build_payload(music.MusicRequest(prompt="lofi", duration=3, bpm=90))
    assert (p["thinking"], p["use_cot_caption"], p["use_cot_language"], p["use_format"]) == (False,) * 4
    assert p["batch_size"] == 1 and p["lyrics"] == "[Instrumental]"
    assert p["audio_duration"] == music.MIN_SECONDS and p["bpm"] == 90 and p["use_random_seed"] is True


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

    async def fake_running():
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

    async def fake_running():
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
