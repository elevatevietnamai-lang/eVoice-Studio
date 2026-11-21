"""Long jobs are not cut off by flat wall-clock caps.

Owner request (2026-11-21): give long-running tasks more time. Where a job reports
progress, the cap becomes an idle timeout under a generous ceiling; where it does
not, the cap grows with the size of the input. Every env override still wins.
"""
import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from services import asr_backend, music  # noqa: E402
from services.ffmpeg_utils import media_timeout_s  # noqa: E402


# ── ASR: whole-file transcribe budget grows with the audio ──────────────────

def test_asr_budget_grows_with_audio_and_keeps_its_floor(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", raising=False)
    base = asr_backend.ASR_TRANSCRIBE_TIMEOUT_S
    assert asr_backend.asr_timeout_for(None) == base
    assert asr_backend.asr_timeout_for(30) == base
    assert asr_backend.asr_timeout_for(600) == pytest.approx(600 * 2 + 60)
    assert asr_backend.asr_timeout_for(3600) > 2 * 3600


def test_asr_env_override_always_wins(monkeypatch):
    monkeypatch.setenv("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", "45")
    monkeypatch.setattr(asr_backend, "ASR_TRANSCRIBE_TIMEOUT_S", 45.0)
    assert asr_backend.asr_timeout_for(3600) == 45.0


def test_guarded_transcribe_uses_the_audio_length(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S", raising=False)
    monkeypatch.setattr(asr_backend, "_timeout_streak", 0)
    monkeypatch.setattr(asr_backend, "active_backend_id", lambda: "whisperx")
    # A tiny base budget: the old flat cap kills a 0.5 s job, the length-scaled one does not.
    monkeypatch.setattr(asr_backend, "ASR_TRANSCRIBE_TIMEOUT_S", 0.2)
    pool = ThreadPoolExecutor(max_workers=2)

    def _work():
        time.sleep(0.5)
        return "done"

    async def _go():
        assert await asr_backend.run_transcribe_guarded(pool, _work, audio_seconds=120) == "done"
        with pytest.raises(asr_backend.ASRTimeoutError):
            await asr_backend.run_transcribe_guarded(pool, _work)

    asyncio.run(_go())
    pool.shutdown(wait=True)


# ── Music: the poll gives up on a stalled song, not on a long one ───────────

def _wrap(data):
    return {"data": data, "code": 200, "error": None, "timestamp": 1, "extra": None}


def _run_song(monkeypatch, tmp_path, shares):
    """Poll a fake ACE-Step task that reports `shares`, then succeeds."""
    polls = iter(shares)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/release_task":
            return httpx.Response(200, json=_wrap({"task_id": "t1", "status": "queued"}))
        if request.url.path == "/query_result":
            share = next(polls, None)
            if share is None:
                result = json.dumps([{"file": "/v1/audio?path=%2Ftmp%2Fa.wav", "status": 1}])
                return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 1, "result": result}]))
            running = json.dumps([{"file": "", "status": 0, "progress": share}])
            return httpx.Response(200, json=_wrap([{"task_id": "t1", "status": 0, "result": running}]))
        if request.url.path == "/v1/audio":
            return httpx.Response(200, content=b"RIFFdata")
        return httpx.Response(404)

    real = httpx.AsyncClient
    monkeypatch.setattr(music.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    real_sleep = asyncio.sleep
    monkeypatch.setattr(music.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    # Each poll counts 2 s: 6 s without progress is "stalled" here.
    monkeypatch.setattr(music, "POLL_TIMEOUT_SECONDS", 6)
    engine = music.AceStepEngine()

    async def fake_running(*_a, **_k):
        return "http://127.0.0.1:9", "k"

    monkeypatch.setattr(engine, "_ensure_running", fake_running)

    async def run():
        return [e async for e in engine.generate(music.MusicRequest(prompt="x"), str(tmp_path / "t.wav"))]

    return asyncio.run(run())


def test_a_song_that_keeps_moving_outlives_the_stall_timeout(monkeypatch, tmp_path):
    # 20 polls (40 s) against a 6 s stall timeout: it finishes because progress keeps moving.
    events = _run_song(monkeypatch, tmp_path, [i / 25 for i in range(1, 21)])
    assert events[-1]["type"] == "done"


def test_a_stalled_song_is_still_stopped(monkeypatch, tmp_path):
    with pytest.raises(RuntimeError, match="took too long"):
        _run_song(monkeypatch, tmp_path, [0.3] * 20)


def test_even_a_moving_song_has_a_ceiling(monkeypatch, tmp_path):
    monkeypatch.setattr(music, "POLL_MAX_SECONDS", 10)
    with pytest.raises(RuntimeError, match="took too long"):
        _run_song(monkeypatch, tmp_path, [i / 25 for i in range(1, 21)])


# ── Media encodes and Demucs: the cap grows with the video ──────────────────

def test_media_timeout_keeps_its_floor_and_grows_with_length():
    assert media_timeout_s(None) == 1800.0
    assert media_timeout_s(300) == 1800.0
    assert media_timeout_s(3600) == pytest.approx(3600 * 3 + 300)
    assert media_timeout_s(float("nan")) == 1800.0


# ── GGUF binary: the per-spawn cap never undercuts the generate budget ──────

def test_gguf_spawn_cap_follows_the_text(monkeypatch):
    monkeypatch.delenv("OMNIVOICE_GGUF_GENERATE_TIMEOUT_S", raising=False)
    from engines.omnivoice_gguf import backend as gguf

    assert gguf._generate_timeout_s() == 600.0
    # Short text: the CPU budget's 600 s floor plus a minute, never below the old 600 s.
    assert 600.0 <= gguf._generate_timeout_s("short") <= 700.0
    assert gguf._generate_timeout_s("x" * 20_000) > 3600
    monkeypatch.setenv("OMNIVOICE_GGUF_GENERATE_TIMEOUT_S", "90")
    assert gguf._generate_timeout_s("x" * 20_000) == 90.0
