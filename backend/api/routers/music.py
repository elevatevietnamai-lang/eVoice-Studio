"""Music Studio: local AI music generation (ACE-Step) and a saved-track library.

* ``GET    /music/status``                — engine installed / running
* ``GET    /music/install-stream``        — install the engine and download the model (SSE)
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
from pydantic import BaseModel, Field

from api.dependencies import require_admin, require_desktop
from core.browser_guard import reject_cross_site_get
from services import music, music_library

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
            request = music.MusicRequest(prompt=body.prompt, lyrics=body.lyrics, instrumental=body.instrumental,
                                         duration=body.duration, bpm=body.bpm, key_scale=body.key_scale,
                                         seed=body.seed, vocal_language=body.vocal_language)
            track_id = music_library.new_id()
            out = str(music_library.audio_path(track_id))
            async for event in engine.generate(request, out):
                if event["type"] == "progress":
                    yield _sse("progress", event)
            record = music_library.save(
                track_id, title=(body.prompt.strip()[:60] or "Untitled"), prompt=body.prompt,
                lyrics=body.lyrics, instrumental=body.instrumental, duration=request.seconds(),
                bpm=body.bpm, seed=body.seed)
            yield _sse("done", {"track": record})
        except Exception as exc:
            logger.warning("music generation failed: %s", exc)
            yield _sse("error", {"error": "music_failed", "stage": "music", "reason": (str(exc) or type(exc).__name__)[-1200:]})
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
