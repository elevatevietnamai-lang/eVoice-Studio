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
