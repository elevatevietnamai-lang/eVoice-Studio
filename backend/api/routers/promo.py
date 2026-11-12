"""Promo video builder: upload clips, stills, a logo and music, then render
them into one short MP4 (``services.promo_video``).

Uploads land in ``OUTPUTS_DIR/promo_media`` under a random id that keeps only
an allow-listed extension; render requests refer to media by that id, never by
path, and every id is resolved back inside that folder. The finished video is
written to ``OUTPUTS_DIR`` and served from ``/audio/<output>`` like the other
renders. CPU only (ffmpeg), so no GPU lock.
"""

from __future__ import annotations

import asyncio
import math
import contextlib
import json
import logging
import os
import re
import shutil
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from core.media_types import AUDIO_EXTS, VIDEO_EXTS
from services import promo_video

logger = logging.getLogger("omnivoice.promo")
router = APIRouter()

IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp"})
#: Per-file upload cap. Ad footage is short; this still fits a few minutes of 4K.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
_MEDIA_ID_RE = re.compile(r"^[0-9a-f]{16}\.[a-z0-9]{2,5}$")
#: Music is analysed for beats over at most this many seconds.
_BEAT_WINDOW_SECONDS = 120.0
_BEAT_SAMPLE_RATE = 22050
_RENDER_TIMEOUT_SECONDS = 1800.0


def _media_dir() -> str:
    from core.config import OUTPUTS_DIR

    path = os.path.join(OUTPUTS_DIR, "promo_media")
    os.makedirs(path, exist_ok=True)
    return path


def _kind_for(ext: str) -> Optional[str]:
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    return None


def resolve_media(media_id: str, *, kinds: tuple[str, ...]) -> str:
    """The local path of an uploaded media id, or 404/422."""
    if not _MEDIA_ID_RE.match(media_id or ""):
        raise HTTPException(status_code=404, detail="Media not found; add the file again")
    root = os.path.realpath(_media_dir())
    path = os.path.realpath(os.path.join(root, media_id))
    if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Media not found; add the file again")
    kind = _kind_for(os.path.splitext(path)[1])
    if kind not in kinds:
        raise HTTPException(status_code=422, detail=f"This file cannot be used as {'/'.join(kinds)}")
    return path


async def _probe(path: str) -> dict:
    """Duration, size and stream kinds via ffprobe; ``{}`` when unreadable."""
    from services.ffmpeg_utils import find_ffprobe, spawn_subprocess

    ffprobe = find_ffprobe()
    if not ffprobe:
        return {}
    proc = await spawn_subprocess(
        ffprobe, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        return {}
    if proc.returncode != 0:
        return {}
    try:
        data = json.loads(stdout or b"{}")
    except ValueError:
        return {}
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    duration = None
    with contextlib.suppress(TypeError, ValueError):
        duration = float((data.get("format") or {}).get("duration"))
    return {
        "has_video": video is not None,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "width": int(video["width"]) if video and video.get("width") else None,
        "height": int(video["height"]) if video and video.get("height") else None,
        "duration": duration,
    }


@router.post("/promo/media")
async def promo_media(file: UploadFile = File(...)) -> dict:
    """Store one clip, still, logo or music file for the promo builder.

    Returns ``{id, kind, name, duration, width, height, has_audio, url}``;
    ``url`` serves the stored file for previews.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    kind = _kind_for(ext)
    if kind is None:
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Use a video, image (.png, .jpg, .webp) or audio file",
        )
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        await file.close()
        raise HTTPException(status_code=413, detail="File is larger than 4 GB")
    media_id = f"{uuid.uuid4().hex[:16]}{ext}"
    path = os.path.join(_media_dir(), media_id)

    def _copy() -> int:
        file.file.seek(0)
        with open(path, "wb") as out:
            shutil.copyfileobj(file.file, out, length=1024 * 1024)
        return os.path.getsize(path)

    try:
        size = await asyncio.to_thread(_copy)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(path)
        raise
    finally:
        await file.close()
    if size == 0 or size > MAX_UPLOAD_BYTES:
        with contextlib.suppress(OSError):
            os.remove(path)
        raise HTTPException(status_code=400, detail="The file is empty or larger than 4 GB")

    info = await _probe(path)
    usable = info.get("has_audio") if kind == "audio" else info.get("has_video")
    if not usable:
        with contextlib.suppress(OSError):
            os.remove(path)
        raise HTTPException(status_code=422, detail="ffmpeg could not read this file")
    return {
        "id": media_id,
        "kind": kind,
        "name": os.path.basename(file.filename or media_id)[:200],
        "duration": None if kind == "image" else info.get("duration"),
        "width": info.get("width"),
        "height": info.get("height"),
        "has_audio": bool(info.get("has_audio")),
        "url": f"/audio/promo_media/{media_id}",
    }


class PromoShotRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    media_id: str
    duration: float = Field(..., gt=0)
    start: float = Field(0.0, ge=0)
    fit: Literal["cover", "contain"] = "cover"
    motion: Literal["none", "zoom_in", "zoom_out"] = "none"
    transition: str = "fade"
    transition_seconds: float = Field(0.5, ge=0, le=promo_video.MAX_TRANSITION_SECONDS)


class PromoOverlayRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    media_id: str
    #: Seconds into the video, or into shot ``shot`` when that is given.
    start: float = Field(0.0, ge=0)
    #: Shot (0-based) the overlay is anchored to. Resolved after beat snapping,
    #: so the overlay stays on its shot when the cuts move.
    shot: Optional[int] = Field(None, ge=0, lt=promo_video.MAX_SHOTS)
    #: Seconds to show; a video overlay defaults to its own length.
    duration: Optional[float] = Field(None, gt=0)


class PromoRenderRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    shots: list[PromoShotRequest] = Field(..., min_length=1, max_length=promo_video.MAX_SHOTS)
    shape: Literal["vertical", "square", "landscape"] = "vertical"
    fps: Literal[30, 60] = 30
    look: str = "none"
    logo_id: Optional[str] = None
    watermark: Literal[
        "none", "top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"
    ] = "none"
    watermark_opacity: float = Field(0.8, ge=0.1, le=1.0)
    outro_seconds: float = Field(0.0, ge=0, le=promo_video.MAX_OUTRO_SECONDS)
    outro_color: str = Field("#0b0b0b", max_length=9)
    music_id: Optional[str] = None
    music_start: float = Field(0.0, ge=0)
    music_volume: float = Field(0.8, ge=0, le=2)
    narration_id: Optional[str] = None
    snap_to_beats: bool = False
    overlays: list[PromoOverlayRequest] = Field(default_factory=list, max_length=promo_video.MAX_OVERLAYS)


_XFADE_CACHE: dict[str, set[str]] = {}


async def _available_transitions() -> set[str]:
    """xfade transitions the installed ffmpeg supports (probed once)."""
    from services.ffmpeg_utils import find_ffmpeg, run_ffmpeg

    ffmpeg = find_ffmpeg()
    if ffmpeg not in _XFADE_CACHE:
        rc, stdout, stderr = await run_ffmpeg(
            [ffmpeg, "-hide_banner", "-h", "filter=xfade"], timeout=30.0,
        )
        text = (stdout or b"").decode(errors="replace") + (stderr or b"").decode(errors="replace")
        _XFADE_CACHE[ffmpeg] = promo_video.xfade_transitions(text) if rc == 0 else set()
    return _XFADE_CACHE[ffmpeg]


async def _require_audio(path: str) -> str:
    if not (await _probe(path)).get("has_audio"):
        raise HTTPException(status_code=422, detail="This file has no sound to use as music or narration")
    return path


async def _beat_grid(music_path: str, start: float) -> tuple[float, float]:
    """``(period, phase)`` of the music from ``start``; ``(0, 0)`` if unknown."""
    import numpy as np
    from services.ffmpeg_utils import find_ffmpeg, run_ffmpeg

    cmd = [
        find_ffmpeg(), "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-t", f"{_BEAT_WINDOW_SECONDS:.0f}", "-i", music_path,
        "-ac", "1", "-ar", str(_BEAT_SAMPLE_RATE), "-f", "f32le", "pipe:1",
    ]
    rc, stdout, _ = await run_ffmpeg(cmd, timeout=120.0)
    if rc != 0 or not stdout:
        return 0.0, 0.0
    samples = np.frombuffer(stdout, dtype=np.float32)
    return await asyncio.to_thread(promo_video.detect_beats, samples, _BEAT_SAMPLE_RATE)


@router.get("/promo/beats/{media_id}")
async def promo_beats(media_id: str, start: float = 0.0) -> dict:
    """Beat grid of a music file, as ``/promo/render`` uses it.

    ``period`` is the beat length in seconds (0 when no steady beat is
    found). With **Cut on the beat** the render starts the music on a beat,
    so in the finished video beats fall at multiples of ``period`` from 0;
    the timeline draws them there and snaps edits to them.
    """
    if not math.isfinite(start) or start < 0:
        raise HTTPException(status_code=422, detail="start must be zero or more")
    path = await _require_audio(resolve_media(media_id, kinds=("audio", "video")))
    period, phase = await _beat_grid(path, start)
    # Full precision: the timeline snaps with the exact period the render uses.
    return {"period": period, "phase": phase}


@router.post("/promo/render")
async def promo_render(req: PromoRenderRequest) -> dict:
    """Render the promo video. Returns ``{output, duration, durations, beat}``:
    ``durations`` are the shot lengths used (changed by ``snap_to_beats``) and
    ``beat`` the detected beat period in seconds (0 when not analysed)."""
    from core.config import OUTPUTS_DIR
    from services.ffmpeg_utils import explain_ffmpeg_failure, find_ffmpeg, run_ffmpeg

    if req.look not in promo_video.LOOKS:
        raise HTTPException(status_code=422, detail=f"Unknown look: {req.look}")
    available = await _available_transitions()
    shots = []
    for shot in req.shots:
        if shot.transition not in promo_video.TRANSITIONS:
            raise HTTPException(status_code=422, detail=f"Unknown transition: {shot.transition}")
        path = resolve_media(shot.media_id, kinds=("video", "image"))
        kind = "image" if _kind_for(os.path.splitext(path)[1]) == "image" else "video"
        start = shot.start
        if kind == "video" and start > 0:
            # A start at or past the end yields no frames at all; keep at
            # least the shortest shot of footage.
            length = (await _probe(path)).get("duration")
            if length:
                start = max(0.0, min(start, length - promo_video.MIN_SHOT_SECONDS))
        shots.append(promo_video.Shot(
            path=path, kind=kind,
            duration=shot.duration, start=start, fit=shot.fit, motion=shot.motion,
            transition=promo_video.usable_transition(shot.transition, available),
            transition_seconds=shot.transition_seconds,
        ))
    logo = resolve_media(req.logo_id, kinds=("image",)) if req.logo_id else None
    music = (
        await _require_audio(resolve_media(req.music_id, kinds=("audio", "video")))
        if req.music_id else None
    )
    narration = (
        await _require_audio(resolve_media(req.narration_id, kinds=("audio", "video")))
        if req.narration_id else None
    )

    overlay_sources = []
    for item in req.overlays:
        if item.shot is not None and item.shot >= len(req.shots):
            raise HTTPException(
                status_code=422, detail=f"Overlay is anchored to shot {item.shot + 1}, which does not exist"
            )
        path = resolve_media(item.media_id, kinds=("video", "image"))
        kind = "image" if _kind_for(os.path.splitext(path)[1]) == "image" else "video"
        duration = item.duration
        if duration is None:
            duration = (await _probe(path)).get("duration") if kind == "video" else None
        if not duration:
            raise HTTPException(status_code=422, detail="Give the overlay a length")
        overlay_sources.append((path, kind, duration, item.shot, item.start))

    music_start = req.music_start
    period = 0.0
    if music and req.snap_to_beats and len(shots) > 1:
        period, phase = await _beat_grid(music, req.music_start)
        if period > 0:
            # Start the music on a beat so the grid sits at multiples of period.
            music_start = req.music_start + phase
            draft = promo_video.PromoPlan(shots=shots)
            durations = promo_video.snap_to_beats(draft, period, phase)
            shots = [
                promo_video.Shot(**{**s.__dict__, "duration": d}) for s, d in zip(shots, durations)
            ]

    timeline = promo_video.PromoPlan(shots=shots)
    overlays = [
        promo_video.Overlay(
            path=path,
            start=start if shot is None else promo_video.anchored_start(timeline, shot, start),
            duration=duration,
            kind=kind,
        )
        for path, kind, duration, shot, start in overlay_sources
    ]

    plan = promo_video.PromoPlan(
        shots=shots, shape=req.shape, fps=req.fps, look=req.look,
        brand=promo_video.Brand(
            logo_path=logo, watermark=req.watermark, watermark_opacity=req.watermark_opacity,
            outro_seconds=req.outro_seconds, outro_color=req.outro_color,
        ),
        audio=promo_video.AudioPlan(
            music_path=music, music_start=music_start, music_volume=req.music_volume,
            narration_path=narration,
        ),
        overlays=overlays,
    )
    try:
        promo_video.validate_plan(plan)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    out_name = f"promo_{uuid.uuid4().hex[:12]}.mp4"
    out_path = os.path.join(OUTPUTS_DIR, out_name)
    cmd = promo_video.build_promo_cmd(find_ffmpeg(), plan, out_path)
    try:
        rc, _, stderr = await run_ffmpeg(cmd, timeout=_RENDER_TIMEOUT_SECONDS)
        if rc != 0:
            raise RuntimeError(stderr.decode(errors="replace") if stderr else "ffmpeg promo non-zero")
    except asyncio.TimeoutError:
        with contextlib.suppress(OSError):
            os.remove(out_path)
        raise HTTPException(status_code=504, detail="Promo render timed out")
    except Exception as exc:
        with contextlib.suppress(OSError):
            os.remove(out_path)
        logger.warning("promo render failed: %s", str(exc)[-2000:])
        raise HTTPException(
            status_code=500, detail=explain_ffmpeg_failure(exc, "render the promo video", cmd=cmd),
        )
    if not os.path.isfile(out_path) or os.path.getsize(out_path) == 0:
        raise HTTPException(status_code=500, detail="Promo render produced no file")
    return {
        "output": out_name,
        "duration": promo_video.program_length(plan),
        "durations": [s.duration for s in plan.shots],
        "beat": period,
    }
