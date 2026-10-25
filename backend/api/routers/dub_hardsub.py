"""Hardcoded (burned-in) subtitles for Dub jobs.

* OCR the on-screen subtitles into the editor's source segments — an alternative
  to ASR that is far more accurate for videos that already carry subtitles
  (typical for Chinese short-form video).
* Remove those subtitles from the picture by reconstructing the frames: real
  background revealed in neighbouring frames first, then LaMa inpainting.
  The cleaned video replaces the job's ``video_path`` so preview, burned-in
  subtitle export and every video export use it; the original is kept and can
  be restored.
"""
from __future__ import annotations

import asyncio
import glob
import json
import logging
import os
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from api.dependencies import require_admin, require_desktop, require_local
from core.browser_guard import reject_cross_site_get
from core.logging_utils import log_safe
from services import dub_pipeline, gpu_exclusive, hardsub
from services.dub_pipeline import replace_source_segments
from services.ffmpeg_utils import find_ffmpeg, local_inputs_only

router = APIRouter()
logger = logging.getLogger("omnivoice.api")

_JOB_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
CUES_FILE = "hardsub_cues.json"
CLEAN_FILE = "hardsub_clean.mp4"
_job_locks: dict[str, asyncio.Lock] = {}


def _sse(event: str, payload: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _stream(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


def _job_or_404(job_id: str) -> tuple[dict, str]:
    if not _JOB_RE.fullmatch(job_id or ""):
        raise HTTPException(status_code=400, detail="Invalid job id")
    job = dub_pipeline.get_job(job_id)
    job_dir = dub_pipeline.safe_job_dir(job_id)
    if not job or not job_dir:
        raise HTTPException(status_code=404, detail="Job not found")
    return job, job_dir


def _source_video(job: dict, job_dir: str) -> str:
    """The video OCR should read: always the original, never a cleaned copy."""
    path = (job.get("hardsub") or {}).get("original_video_path") or job.get("video_path")
    if not path:
        raise HTTPException(status_code=400, detail="This job has no video.")
    real = os.path.realpath(path if os.path.isabs(path) else os.path.join(job_dir, path))
    if not real.startswith(os.path.realpath(job_dir) + os.sep) or not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="Source video not found")
    return real


def _lock(job_id: str) -> asyncio.Lock:
    return _job_locks.setdefault(job_id, asyncio.Lock())


def _drop_preview_caches(job_dir: str) -> None:
    """Muxed previews embed the old picture; force a rebuild on next request."""
    for path in glob.glob(os.path.join(job_dir, "exports", "preview_*.mp4")):
        try:
            os.remove(path)
        except OSError:
            pass


def _public_state(job: dict) -> dict:
    hs = job.get("hardsub") or {}
    return {
        "region": hs.get("region"),
        "cue_count": hs.get("cue_count", 0),
        "cleaned": bool(hs.get("original_video_path")),
        "method": hs.get("method"),
        "revision": hs.get("revision", 0),
    }


# ───────────────────────────────────────────────────────────── engine

@router.get("/dub/hardsub/status")
def hardsub_status():
    return hardsub.status()


@router.get("/dub/hardsub/install-stream",
            dependencies=[Depends(reject_cross_site_get), Depends(require_local), Depends(require_admin),
                          Depends(require_desktop)])
async def hardsub_install_stream():
    async def gen():
        try:
            async for event in hardsub.install():
                kind = event.pop("type", "progress")
                yield _sse(kind, event)
        except Exception as exc:  # surfaced in-stream, see transcribe-stream
            logger.warning("hardsub install failed: %s", exc)
            yield _sse("error", {"error": "install_failed", "reason": str(exc)[-1500:]})
    return _stream(gen())


# ───────────────────────────────────────────────────────────── job state

@router.get("/dub/hardsub/state/{job_id}")
def hardsub_state(job_id: str):
    job, _ = _job_or_404(job_id)
    return _public_state(job)


@router.get("/dub/hardsub/frame/{job_id}", dependencies=[Depends(reject_cross_site_get)])
async def hardsub_frame(job_id: str, t: float = Query(0.0, ge=0.0), width: int = Query(960, ge=160, le=1920)):
    """A JPEG frame of the ORIGINAL video for drawing the subtitle region."""
    job, job_dir = _job_or_404(job_id)
    video = _source_video(job, job_dir)
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=503, detail="ffmpeg not found")
    duration = float(job.get("duration") or 0.0)
    if duration > 0:
        t = min(t, max(0.0, duration - 0.05))
    cmd = local_inputs_only([ffmpeg, "-v", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1",
                             "-vf", f"scale='min({width},iw)':-2", "-q:v", "3", "-f", "image2", "pipe:1"])
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    if proc.returncode != 0 or not out:
        raise HTTPException(status_code=500, detail="Could not read a frame: " + err.decode(errors="ignore")[-300:])
    return Response(out, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/dub/hardsub/ocr-stream/{job_id}", dependencies=[Depends(reject_cross_site_get)])
async def hardsub_ocr_stream(
    job_id: str,
    top: float = Query(0.62, ge=0.0, le=1.0),
    bottom: float = Query(0.98, ge=0.0, le=1.0),
    fps: float = Query(4.0, ge=1.0, le=12.0),
    any_script: bool = Query(False),
):
    """Read the burned-in subtitles and make them the job's source segments."""

    async def gen():
        try:
            job, job_dir = _job_or_404(job_id)
            if bottom - top < 0.03:
                raise ValueError("The subtitle region is too small.")
            if not hardsub.is_installed():
                yield _sse("error", {"error": "hardsub_not_installed",
                                     "reason": "Install the on-screen subtitle engine first."})
                return
            video = _source_video(job, job_dir)
            lock = _lock(job_id)
            if lock.locked():
                raise RuntimeError("Another on-screen subtitle task is running for this video.")
            async with gpu_exclusive.dub_job(), lock:
                out = os.path.join(job_dir, CUES_FILE + ".tmp")
                args = ["ocr", "--video", video, "--top", f"{top:.4f}", "--bottom", f"{bottom:.4f}",
                        "--fps", f"{fps:g}", "--out", out]
                if any_script:
                    args.append("--any-script")
                async for event in hardsub.run_cli(args):
                    if event.get("type") == "progress":
                        yield _sse("progress", {"progress": event.get("progress", 0),
                                                "message": event.get("message", "")})
                with open(out, encoding="utf-8") as f:
                    data = json.load(f)
                os.replace(out, os.path.join(job_dir, CUES_FILE))
                segments = _apply_cues(job_id, data, top, bottom)
            yield _sse("final", {"segments": segments, "source_lang": "zh",
                                 "state": _public_state(dub_pipeline.get_job(job_id) or {})})
            yield _sse("done", {"count": len(segments)})
        except Exception as exc:
            logger.warning("hardsub OCR failed for %s: %s", log_safe(job_id), exc)
            yield _sse("error", {"error": "hardsub_ocr_failed", "stage": "ocr", "reason": str(exc)[-1500:]})

    return _stream(gen())


_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")


def _join_lines(raw: str) -> str:
    """Two on-screen lines become one segment: no space between CJK lines."""
    lines = [" ".join(line.split()) for line in raw.splitlines() if line.strip()]
    out = ""
    for line in lines:
        if out and not (_CJK.search(out[-1]) and _CJK.search(line[0])):
            out += " "
        out += line
    return out


def _apply_cues(job_id: str, data: dict, top: float, bottom: float) -> list[dict]:
    from api.routers.dub_core import _carry_srt_voice_metadata
    from services.speaker_clone import build_cast_sources

    job = dub_pipeline.get_job(job_id) or {}
    duration = float(job.get("duration") or 0.0)
    segments: list[dict] = []
    for cue in data.get("cues", []):
        text = _join_lines(str(cue.get("text") or ""))
        start, end = float(cue["start"]), float(cue["end"])
        if not text or end <= start or (duration > 0 and start >= duration):
            continue
        if duration > 0:
            end = min(end, duration)
        segments.append({"id": len(segments), "start": round(start, 3), "end": round(end, 3),
                         "text": text, "text_original": text, "speaker_id": "Speaker 1"})
    if not segments:
        raise RuntimeError("No subtitles were found in the selected region. "
                           "Adjust the region so it covers the subtitle line and try again.")
    with dub_pipeline._dub_jobs_lock:
        job = dub_pipeline.get_job(job_id)
        if not job:
            raise RuntimeError("The job was deleted.")
        prior = [s for s in (job.get("segments") or []) if isinstance(s, dict)]
        segments, segment_clones = _carry_srt_voice_metadata(
            segments, prior, job.get("segment_clones"), job.get("speaker_clones"))
        replace_source_segments(job, segments)
        job["segment_clones"] = segment_clones
        job["speaker_clones"] = {}
        if segment_clones:
            job["cast_sources"] = build_cast_sources(segments, None, segment_clones)
        else:
            job.pop("cast_sources", None)
        hs = dict(job.get("hardsub") or {})
        hs.update(region=[top, bottom], cue_count=len(data.get("cues", [])), ocr_at=time.time())
        job["hardsub"] = hs
        job["source_lang_override"] = job.get("source_lang_override") or "zh"
        dub_pipeline.save_job(job_id, job)
    return segments


# ───────────────────────────────────────────────────────────── removal

@router.get("/dub/hardsub/clean-stream/{job_id}", dependencies=[Depends(reject_cross_site_get)])
async def hardsub_clean_stream(job_id: str, method: str = Query("lama", pattern="^(sttn|lama|propainter|opencv)$")):
    """Remove the OCR'd subtitles from the picture and use the result as the job video."""

    async def gen():
        try:
            job, job_dir = _job_or_404(job_id)
            cues = os.path.join(job_dir, CUES_FILE)
            if not os.path.isfile(cues):
                raise RuntimeError("Read the on-screen subtitles first, so their positions are known.")
            if not hardsub.is_installed():
                yield _sse("error", {"error": "hardsub_not_installed",
                                     "reason": "Install the on-screen subtitle engine first."})
                return
            video = _source_video(job, job_dir)
            lock = _lock(job_id)
            if lock.locked():
                raise RuntimeError("Another on-screen subtitle task is running for this video.")
            async with gpu_exclusive.dub_job(), lock:
                tmp = os.path.join(job_dir, "hardsub_clean.tmp.mp4")
                args = ["clean", "--video", video, "--cues", cues, "--method", method,
                        "--models", str(hardsub.models_dir()), "--out", tmp]
                async for event in hardsub.run_cli(args):
                    kind = event.get("type")
                    if kind == "progress":
                        yield _sse("progress", {"progress": event.get("progress", 0),
                                                "message": event.get("message", "")})
                    elif kind == "log":
                        yield _sse("log", {"message": event.get("message", "")})
                final = os.path.join(job_dir, CLEAN_FILE)
                os.replace(tmp, final)
                with dub_pipeline._dub_jobs_lock:
                    job = dub_pipeline.get_job(job_id)
                    if not job:
                        raise RuntimeError("The job was deleted.")
                    hs = dict(job.get("hardsub") or {})
                    hs.setdefault("original_video_path", video)
                    hs.update(method=method, cleaned_at=time.time(),
                              revision=int(hs.get("revision", 0)) + 1)
                    job["hardsub"] = hs
                    job["video_path"] = final
                    dub_pipeline.save_job(job_id, job)
                    state = _public_state(job)
                _drop_preview_caches(job_dir)
            yield _sse("done", {"state": state})
        except Exception as exc:
            logger.warning("hardsub removal failed for %s: %s", log_safe(job_id), exc)
            yield _sse("error", {"error": "hardsub_clean_failed", "stage": "inpaint", "reason": str(exc)[-1500:]})

    return _stream(gen())


@router.post("/dub/hardsub/restore/{job_id}")
def hardsub_restore(job_id: str):
    """Use the original (subtitled) video again."""
    job, job_dir = _job_or_404(job_id)
    with dub_pipeline._dub_jobs_lock:
        job = dub_pipeline.get_job(job_id) or job
        hs = dict(job.get("hardsub") or {})
        original = hs.pop("original_video_path", None)
        if original:
            job["video_path"] = original
            hs["revision"] = int(hs.get("revision", 0)) + 1
            hs.pop("method", None)
            job["hardsub"] = hs
            dub_pipeline.save_job(job_id, job)
    _drop_preview_caches(job_dir)
    return _public_state(job)

