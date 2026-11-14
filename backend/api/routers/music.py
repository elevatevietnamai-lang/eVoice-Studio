"""Music Studio: local AI music generation (ACE-Step) and a saved-track library.

* ``GET    /music/status``                — engine installed / running
* ``GET    /music/install-stream``        — install the engine and download the model (SSE)
* ``GET    /music/lm``                    — which language model Thinking uses here, and if it is ready
* ``GET    /music/lm-install-stream``     — download the small language model for 6-12 GB GPUs (SSE)
* ``POST   /music/stop``                  — stop the music server now (frees VRAM)
* ``POST   /music/generate``              — generate 1-4 variants and save them to the library (SSE)
* ``POST   /music/format``                — the language model tidies caption and lyrics, suggests metadata
* ``POST   /music/upload``                — store a source or reference audio file; returns its id
* ``GET    /music/models``                — the DiT models (turbo, SFT, base) and which are downloaded
* ``GET    /music/model-install-stream``  — download the pinned SFT or base model (SSE)
* ``GET    /music/library``               — saved tracks, newest first
* ``GET    /music/audio/{track_id}``      — a saved track
* ``DELETE /music/library/{track_id}``    — remove a saved track
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    batch_size: int = Field(1, ge=1, le=music.MAX_BATCH)
    # Bounds per model are checked below (turbo 4-20, SFT/base 8-64).
    inference_steps: int = Field(music.DEFAULT_STEPS, ge=music.MIN_STEPS, le=64)
    infer_method: Literal["ode", "sde"] = "ode"
    audio_format: Literal["wav", "flac", "mp3"] = "wav"
    # Edits (cover, repaint) and a style reference. Audio is named by a library track id or an
    # upload id from POST /music/upload, never by a path.
    task: Literal["text2music", "cover", "repaint"] = "text2music"
    source_track_id: str | None = Field(None, max_length=12)
    source_upload_id: str | None = Field(None, max_length=12)
    reference_track_id: str | None = Field(None, max_length=12)
    reference_upload_id: str | None = Field(None, max_length=12)
    cover_strength: float = Field(0.7, ge=0.0, le=1.0)
    repaint_start: float = Field(0.0, ge=0.0, le=music.MAX_SOURCE_SECONDS)
    repaint_end: float | None = Field(None, ge=0.0, le=music.MAX_SOURCE_SECONDS)
    repaint_mode: Literal["conservative", "balanced", "aggressive"] = "balanced"
    repaint_strength: float = Field(0.5, ge=0.0, le=1.0)
    # DiT model; guidance, shift, ADG and the CFG interval only apply to SFT and base.
    model: Literal["turbo", "sft", "base"] = "turbo"
    guidance_scale: float = Field(music.GUIDANCE_RANGE[2], ge=music.GUIDANCE_RANGE[0], le=music.GUIDANCE_RANGE[1])
    shift: float = Field(music.SHIFT_RANGE[2], ge=music.SHIFT_RANGE[0], le=music.SHIFT_RANGE[1])
    use_adg: bool = False
    cfg_interval_start: float = Field(0.0, ge=0.0, le=1.0)
    cfg_interval_end: float = Field(1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _one_source(self) -> "GenerateBody":
        low, high, _default = music.DIT_MODELS[self.model]["steps"]
        if not low <= self.inference_steps <= high:
            raise ValueError(f"The {self.model} model takes {low}-{high} steps.")
        if self.cfg_interval_end < self.cfg_interval_start:
            raise ValueError("The CFG interval must end after it starts.")
        sources = [v for v in (self.source_track_id, self.source_upload_id) if v]
        if self.task != "text2music" and len(sources) != 1:
            raise ValueError("A cover or repaint needs one source track or uploaded file.")
        if self.task == "text2music" and sources:
            raise ValueError("A source track is only used for a cover or repaint.")
        if self.reference_track_id and self.reference_upload_id:
            raise ValueError("Pick one style reference.")
        if self.task == "repaint" and self.repaint_end is not None and self.repaint_end <= self.repaint_start:
            raise ValueError("The repaint region must end after it starts.")
        return self

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

    def to_request(self) -> music.MusicRequest:
        return music.MusicRequest(prompt=self.prompt, lyrics=self.lyrics, instrumental=self.instrumental,
                                  duration=self.duration, bpm=self.bpm, key_scale=self.key_scale,
                                  seed=self.seed, vocal_language=self.vocal_language,
                                  time_signature=self.time_signature, thinking=self.thinking,
                                  batch_size=self.batch_size, inference_steps=self.inference_steps,
                                  infer_method=self.infer_method, audio_format=self.audio_format,
                                  task_type=self.task, cover_strength=self.cover_strength,
                                  repaint_start=self.repaint_start, repaint_end=self.repaint_end,
                                  repaint_mode=self.repaint_mode, repaint_strength=self.repaint_strength,
                                  model=self.model, guidance_scale=self.guidance_scale, shift=self.shift,
                                  use_adg=self.use_adg, cfg_interval_start=self.cfg_interval_start,
                                  cfg_interval_end=self.cfg_interval_end)


def _audio_for(track_id: str | None, upload_id: str | None) -> str | None:
    if track_id:
        return str(music_library.resolve_track_audio(track_id))
    if upload_id:
        return str(music_library.resolve_upload(upload_id))
    return None


async def resolve_audio(body: GenerateBody) -> music.MusicRequest:
    """The request with source and reference files resolved under the library (ValueError if not)."""
    from services.ffmpeg_utils import probe_duration

    request = body.to_request()
    request.ref_path = _audio_for(body.reference_track_id, body.reference_upload_id)
    if body.task == "text2music":
        return request
    request.src_path = _audio_for(body.source_track_id, body.source_upload_id)
    seconds = await probe_duration(request.src_path, allowed_root=str(music_library.library_dir()))
    if not seconds:
        raise ValueError("Could not read the source audio.")
    if seconds > music.MAX_SOURCE_SECONDS:
        raise ValueError(f"The source is longer than {music.MAX_SOURCE_SECONDS // 60} minutes.")
    request.src_seconds = seconds
    if body.task == "repaint":
        end = body.repaint_end if body.repaint_end is not None else seconds
        if body.repaint_start >= seconds or end > seconds + 0.5:
            raise ValueError("The repaint region is outside the source audio.")
    return request


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


@router.get("/music/models", dependencies=[Depends(reject_cross_site_get)])
def music_models():
    return {"models": music.get_engine().models_status()}


@router.get("/music/model-install-stream",
            dependencies=[Depends(reject_cross_site_get), Depends(require_admin), Depends(require_desktop)])
async def music_model_install_stream(model: Literal["sft", "base"]):
    async def gen():
        try:
            async for event in music.get_engine().install_model(model):
                yield _sse("done" if event["type"] == "done" else event["type"], event)
        except Exception as exc:
            logger.warning("music model download failed: %s", exc)
            yield _sse("error", {"error": "music_model_install_failed", "stage": "install",
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
            if music_library.free_slots() < body.batch_size:
                yield _sse("error", {"error": "music_library_full", "stage": "music",
                                     "reason": f"The library holds {music_library.MAX_TRACKS} tracks. "
                                               f"Delete some first to make room for {body.batch_size}."})
                return
            try:
                request = await resolve_audio(body)
            except ValueError as exc:
                yield _sse("error", {"error": "music_source_invalid", "error_code": "music_source_invalid",
                                     "stage": "music", "reason": str(exc)})
                return
            ids = [music_library.new_id() for _ in range(body.batch_size)]
            paths = {str(music_library.audio_path(i, body.audio_format)): i for i in ids}
            result: dict = {}
            with gpu_exclusive.music_job():
                async for event in engine.generate(request, list(paths)):
                    if event["type"] == "progress":
                        yield _sse("progress", event)
                    elif event["type"] == "done":
                        result = event
            title = body.prompt.strip()[:60] or "Untitled"
            batch_id = ids[0] if body.batch_size > 1 else None
            records = []
            for index, variant in enumerate(result.get("tracks") or []):
                # What the server really used: a random seed it picked, or metadata the LM filled.
                records.append(music_library.save(
                    paths[variant["path"]], title=title, prompt=body.prompt,
                    lyrics=body.lyrics, instrumental=body.instrumental, duration=request.seconds(),
                    bpm=variant.get("bpm") or body.bpm,
                    seed=variant["seed"] if variant.get("seed") is not None else body.seed,
                    key_scale=variant.get("key_scale") or body.key_scale,
                    time_signature=variant.get("time_signature") or body.time_signature,
                    vocal_language=body.vocal_language, thinking=body.thinking, ext=body.audio_format,
                    inference_steps=body.inference_steps, infer_method=body.infer_method,
                    batch_id=batch_id, variant=index + 1 if batch_id else None,
                    task=body.task, source_id=body.source_track_id, model=body.model))
                yield _sse("track", {"track": records[-1]})
            if not records:
                raise RuntimeError("Music generation finished without a downloadable file.")
            yield _sse("done", {"track": records[0], "tracks": records})
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


@router.post("/music/format")
async def music_format(body: GenerateBody):
    """Run the language model's formatter on the form. Returns suggestions; nothing is saved."""
    if not music.is_installed():
        raise HTTPException(status_code=409, detail={"error_code": "music_not_installed",
                                                     "reason": "Install the music engine first."})
    try:
        with gpu_exclusive.music_job():
            return await music.get_engine().format_input(await resolve_audio(body))
    except music.MusicLmUnavailable as exc:
        raise HTTPException(status_code=409, detail={"error_code": exc.code, "reason": str(exc)})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error_code": "music_source_invalid", "reason": str(exc)})
    except music.MusicModeBusy as exc:
        raise HTTPException(status_code=409, detail={"error_code": "gpu_busy", "busy_with": "music",
                                                     "reason": str(exc)})
    except gpu_exclusive.GpuBusy as exc:
        raise HTTPException(status_code=409, detail={"error_code": "gpu_busy", "busy_with": exc.busy_with,
                                                     "reason": str(exc)})
    except Exception as exc:
        logger.warning("music format failed: %s", exc)
        raise HTTPException(status_code=502, detail={"error_code": "music_format_failed",
                                                     "reason": music.public_reason(exc)})


_UPLOAD_CHUNK = 1024 * 1024


@router.post("/music/upload")
async def music_upload(file: UploadFile = File(...)):
    """Store a source or reference audio file under the library and return its id and length."""
    from services.ffmpeg_utils import probe_duration

    try:
        ext = music_library.upload_ext(file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error_code": "music_upload_type", "reason": str(exc)})
    upload_id = music_library.new_id()
    path = music_library.upload_path(upload_id, ext)
    size = 0
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(_UPLOAD_CHUNK):
                size += len(chunk)
                if size > music_library.MAX_UPLOAD_BYTES:
                    raise ValueError(f"The file is larger than {music_library.MAX_UPLOAD_BYTES // 2**20} MB.")
                out.write(chunk)
        seconds = await probe_duration(str(path), allowed_root=str(music_library.library_dir()))
        if not seconds:
            raise ValueError("That file has no audio this app can read.")
        if seconds > music.MAX_SOURCE_SECONDS:
            raise ValueError(f"The file is longer than {music.MAX_SOURCE_SECONDS // 60} minutes.")
    except ValueError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail={"error_code": "music_upload_invalid", "reason": str(exc)})
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    music_library.prune_uploads()
    return {"upload_id": upload_id, "name": (file.filename or "")[-120:], "duration": round(seconds, 2)}


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
    ext = record.get("ext", "wav")
    return FileResponse(music_library.audio_path(track_id, ext),
                        media_type=music.AUDIO_MEDIA_TYPES.get(ext, "application/octet-stream"),
                        filename=f"{track_id}.{ext}", content_disposition_type="inline",
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
