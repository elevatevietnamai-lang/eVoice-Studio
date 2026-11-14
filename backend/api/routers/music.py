"""Music Studio: local AI music generation (ACE-Step) and a saved-track library.

* ``GET    /music/status``                — engine installed / running
* ``GET    /music/install-stream``        — install the engine and download the model (SSE)
* ``GET    /music/lm``                    — which language model Thinking uses here, and if it is ready
* ``GET    /music/lm-install-stream``     — download the small language model for 6-12 GB GPUs (SSE)
* ``POST   /music/stop``                  — stop the music server now (frees VRAM)
* ``POST   /music/generate``              — generate a track and save it to the library (SSE)
* ``GET    /music/library``               — saved tracks, newest first
* ``GET    /music/audio/{track_id}``      — a saved track
* ``DELETE /music/library/{track_id}``    — remove a saved track
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from api.dependencies import require_admin, require_desktop
from core.browser_guard import reject_cross_site_get
from services import gpu_exclusive, music, music_library

router = APIRouter()
logger = logging.getLogger("omnivoice.api")


class GenerateBody(BaseModel):
    prompt: str = Field("", max_length=1000)
    lyrics: str = Field("", max_length=8000)
    instrumental: bool = True
    duration: float = Field(60.0, ge=music.MIN_SECONDS, le=music.MAX_SECONDS)
    bpm: int | None = Field(None, ge=30, le=300)
    key_scale: str = Field("", max_length=24)
    seed: int | None = Field(None, ge=0, le=2**31 - 1)
    vocal_language: str = Field("en", max_length=8)
    time_signature: Literal["", "2", "3", "4", "6"] = ""
    thinking: bool = False

    @field_validator("vocal_language")
    @classmethod
    def _known_language(cls, value: str) -> str:
        value = (value or "en").strip().lower()
        if value not in music.VOCAL_LANGUAGES:
            raise ValueError("Unsupported vocal language")
        return value

    @field_validator("key_scale")
    @classmethod
    def _known_key(cls, value: str) -> str:
        return music.normalize_key_scale(value)


def _sse(event: str, payload: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _stream(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@router.get("/music/status")
def music_status():
    return music.get_engine().status()


@router.get("/music/install-stream",
            dependencies=[Depends(reject_cross_site_get), Depends(require_admin), Depends(require_desktop)])
async def music_install_stream():
    async def gen():
        try:
            async for event in music.get_engine().install():
                yield _sse("done" if event["type"] == "done" else event["type"], event)
        except Exception as exc:
            logger.warning("music install failed: %s", exc)
            yield _sse("error", {"error": "music_install_failed", "stage": "install", "reason": (str(exc) or type(exc).__name__)[-1200:]})
    return _stream(gen())


@router.get("/music/lm", dependencies=[Depends(reject_cross_site_get)])
async def music_lm():
    if not music.is_installed():
        return {"model": None, "ready": False, "download_bytes": 0, "installed": False}
    try:
        return {**await music.get_engine().lm_status(), "installed": True}
    except Exception as exc:
        logger.warning("music LM probe failed: %s", exc)
        raise HTTPException(status_code=503, detail=music.public_reason(exc))


@router.get("/music/lm-install-stream",
            dependencies=[Depends(reject_cross_site_get), Depends(require_admin), Depends(require_desktop)])
async def music_lm_install_stream():
    async def gen():
        try:
            async for event in music.get_engine().install_lm():
                yield _sse("done" if event["type"] == "done" else event["type"], event)
        except Exception as exc:
            logger.warning("music LM download failed: %s", exc)
            yield _sse("error", {"error": "music_lm_install_failed", "stage": "install",
                                 "reason": (str(exc) or type(exc).__name__)[-1200:]})
    return _stream(gen())


async def _stop_idle_music() -> None:
    engine = music.get_engine()
    if not engine.is_busy():
        await engine.stop()


gpu_exclusive.register_music_stop(_stop_idle_music)


@router.post("/music/stop", dependencies=[Depends(require_admin)])
async def music_stop():
    await music.get_engine().stop()
    return {"stopped": True}


@router.post("/music/generate")
async def music_generate(body: GenerateBody):
    async def gen():
        engine = music.get_engine()
        try:
            if not music.is_installed():
                yield _sse("error", {"error": "music_not_installed",
                                     "reason": "Install the music engine first."})
                return
            if music_library.is_full():
                yield _sse("error", {"error": "music_library_full", "stage": "music",
                                     "reason": f"The library holds {music_library.MAX_TRACKS} tracks. Delete some first."})
                return
            request = music.MusicRequest(prompt=body.prompt, lyrics=body.lyrics, instrumental=body.instrumental,
                                         duration=body.duration, bpm=body.bpm, key_scale=body.key_scale,
                                         seed=body.seed, vocal_language=body.vocal_language,
                                         time_signature=body.time_signature, thinking=body.thinking)
            track_id = music_library.new_id()
            out = str(music_library.audio_path(track_id))
            result: dict = {}
            with gpu_exclusive.music_job():
                async for event in engine.generate(request, out):
                    if event["type"] == "progress":
                        yield _sse("progress", event)
                    elif event["type"] == "done":
                        result = event
            # What the server really used: a random seed it picked, or metadata the LM filled.
            record = music_library.save(
                track_id, title=(body.prompt.strip()[:60] or "Untitled"), prompt=body.prompt,
                lyrics=body.lyrics, instrumental=body.instrumental, duration=request.seconds(),
                bpm=result.get("bpm") or body.bpm,
                seed=result["seed"] if result.get("seed") is not None else body.seed,
                key_scale=result.get("key_scale") or body.key_scale,
                time_signature=result.get("time_signature") or body.time_signature,
                vocal_language=body.vocal_language, thinking=body.thinking)
            yield _sse("done", {"track": record})
        except music.MusicLmUnavailable as exc:
            yield _sse("error", {"error": exc.code, "error_code": exc.code, "stage": "music", "reason": str(exc)})
        except music.MusicModeBusy as exc:
            yield _sse("error", {"error": "gpu_busy", "error_code": "gpu_busy", "busy_with": "music",
                                 "stage": "music", "reason": str(exc)})
        except gpu_exclusive.GpuBusy as exc:
            yield _sse("error", {"error": "gpu_busy", "error_code": "gpu_busy", "busy_with": exc.busy_with, "stage": "music", "reason": str(exc)})
        except Exception as exc:
            logger.warning("music generation failed: %s", exc)
            yield _sse("error", {"error": "music_failed", "stage": "music", "reason": music.public_reason(exc)})
    return _stream(gen())


@router.get("/music/library")
def music_list():
    return {"tracks": music_library.list_tracks()}


@router.get("/music/audio/{track_id}", dependencies=[Depends(reject_cross_site_get)])
def music_audio(track_id: str):
    try:
        record = music_library.get(track_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid track id")
    if not record:
        raise HTTPException(status_code=404, detail="Track not found")
    return FileResponse(music_library.audio_path(track_id, record.get("ext", "wav")), media_type="audio/wav",
                        headers={"Cache-Control": "no-store"})


@router.delete("/music/library/{track_id}")
def music_delete(track_id: str):
    try:
        removed = music_library.delete(track_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid track id")
    if not removed:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"deleted": True}
