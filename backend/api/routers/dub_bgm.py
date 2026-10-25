"""AI background music (ACE-Step) for Dub jobs.

Replaces the source's background audio — often copyrighted music in re-uploaded
videos — with a generated instrumental, ducked under the dubbed speech.

* ``GET /dub/bgm/status``                     — is the music engine installed?
* ``GET /dub/bgm/generate-stream/{job}``      — generate a track sized to the video (SSE)
* ``GET /dub/bgm/preview/{job}``              — the generated track
* ``GET /dub/bgm/export-stream/{job}?lang=``  — mux video + dubbed speech + AI music (SSE)
* ``GET /dub/bgm/download/{job}?file=``       — the exported MP4
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from core.browser_guard import reject_cross_site_get
from core.logging_utils import log_safe
from services import bgm, dub_pipeline, gpu_exclusive
from services.ffmpeg_utils import find_ffmpeg, local_inputs_only

router = APIRouter()
logger = logging.getLogger("omnivoice.api")

_JOB_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
_LANG_RE = re.compile(r"[A-Za-z0-9_-]{1,16}")
_FILE_RE = re.compile(r"bgm_[A-Za-z0-9_-]{1,16}_\d{10,}\.mp4")
BGM_FILE = "bgm_ai.wav"


def _sse(event: str, payload: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _stream(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


def _job(job_id: str) -> tuple[dict, str]:
    if not _JOB_RE.fullmatch(job_id or ""):
        raise HTTPException(status_code=400, detail="Invalid job id")
    job = dub_pipeline.get_job(job_id)
    job_dir = dub_pipeline.safe_job_dir(job_id)
    if not job or not job_dir:
        raise HTTPException(status_code=404, detail="Job not found")
    return job, job_dir


def _inside(job_dir: str, path: str | None) -> str | None:
    if not path:
        return None
    real = os.path.realpath(path if os.path.isabs(path) else os.path.join(job_dir, path))
    if real.startswith(os.path.realpath(job_dir) + os.sep) and os.path.isfile(real):
        return real
    return None


@router.get("/dub/bgm/status")
async def bgm_status():
    return await bgm.status()


@router.get("/dub/bgm/state/{job_id}")
def bgm_state(job_id: str):
    job, job_dir = _job(job_id)
    info = job.get("bgm") or {}
    has = bool(_inside(job_dir, info.get("path")))
    return {"has_track": has, "style": info.get("style"), "revision": info.get("revision", 0)}


@router.get("/dub/bgm/generate-stream/{job_id}", dependencies=[Depends(reject_cross_site_get)])
async def bgm_generate_stream(job_id: str, style: str = Query("", max_length=400),
                              seed: int | None = Query(None), bpm: int | None = Query(None, ge=40, le=220)):
    async def gen():
        try:
            job, job_dir = _job(job_id)
            duration = float(job.get("duration") or 0.0)
            if duration <= 0:
                raise RuntimeError("The video duration is unknown; prepare the video first.")
            st = await bgm.status()
            if not st["installed"]:
                yield _sse("error", {"error": "bgm_not_installed",
                                     "reason": "Install the music engine first (Music Studio)."})
                return
            out = os.path.join(job_dir, BGM_FILE)
            with gpu_exclusive.music_job():
                async for event in bgm.generate(style, duration, out, seed=seed, bpm=bpm):
                    if event["type"] == "progress":
                        yield _sse("progress", event)
            with dub_pipeline._dub_jobs_lock:
                job = dub_pipeline.get_job(job_id)
                if not job:
                    raise RuntimeError("The job was deleted.")
                info = dict(job.get("bgm") or {})
                info.update(path=out, style=style, seed=seed, created_at=time.time(),
                            revision=int(info.get("revision", 0)) + 1)
                job["bgm"] = info
                dub_pipeline.save_job(job_id, job)
            yield _sse("done", {"revision": info["revision"]})
        except Exception as exc:
            logger.warning("bgm generation failed for %s: %s", log_safe(job_id), exc)
            yield _sse("error", {"error": "bgm_failed", "stage": "music", "reason": (str(exc) or type(exc).__name__)[-1200:]})
    return _stream(gen())


@router.get("/dub/bgm/preview/{job_id}", dependencies=[Depends(reject_cross_site_get)])
def bgm_preview(job_id: str):
    job, job_dir = _job(job_id)
    path = _inside(job_dir, (job.get("bgm") or {}).get("path"))
    if not path:
        raise HTTPException(status_code=404, detail="No AI music for this job yet")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.get("/dub/bgm/export-stream/{job_id}", dependencies=[Depends(reject_cross_site_get)])
async def bgm_export_stream(job_id: str, lang: str = Query(...), music_gain: float = Query(0.35, ge=0.0, le=1.5),
                            burn: bool = Query(True)):
    async def gen():
        try:
            job, job_dir = _job(job_id)
            if not _LANG_RE.fullmatch(lang):
                raise ValueError("Invalid language code")
            track = (job.get("dubbed_tracks") or {}).get(lang) or {}
            speech = _inside(job_dir, track.get("path"))
            if not speech:
                raise RuntimeError("Generate the dub for this language first.")
            if track.get("timing_strategy") == "stretch_video":
                raise RuntimeError("AI music export does not support the Stretch Video timing mode yet.")
            music = _inside(job_dir, (job.get("bgm") or {}).get("path"))
            if not music:
                raise RuntimeError("Generate the AI music first.")
            video = _inside(job_dir, job.get("video_path"))
            if not video:
                raise RuntimeError("Source video not found.")
            ffmpeg = find_ffmpeg()
            if not ffmpeg:
                raise RuntimeError("ffmpeg not found")
            duration = float(job.get("duration") or 0.0)
            exports = os.path.join(job_dir, "exports")
            os.makedirs(exports, exist_ok=True)
            stamp = str(int(time.time() * 1000))
            name = f"bgm_{lang}_{stamp}.mp4"
            out = os.path.join(exports, name)

            fade_at = max(0.0, duration - 2.0)
            audio_graph = (
                f"[2:a]atrim=0:{duration:.3f},asetpts=N/SR/TB,volume={music_gain:.3f},"
                f"afade=t=out:st={fade_at:.3f}:d=2[m];"
                f"[1:a]apad=whole_dur={duration:.3f},asplit=2[s1][s2];"
                "[m][s2]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[md];"
                "[s1][md]amix=inputs=2:duration=first:normalize=0[a]"
            )
            vf = None
            if burn:
                from api.routers.dub_export import (_ffmpeg_filter_escape, _hardsub_burn_style,
                                                    _write_burn_srt)
                srt = _write_burn_srt(job, exports, stamp, False, lang=lang)
                if srt:
                    vf = f"[0:v]subtitles='{_ffmpeg_filter_escape(srt)}'{_hardsub_burn_style(job)}[v]"
            graph = audio_graph + (";" + vf if vf else "")
            cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
                   "-i", video, "-i", speech, "-stream_loop", "-1", "-i", music,
                   "-filter_complex", graph, "-map", "[v]" if vf else "0:v:0", "-map", "[a]"]
            cmd += (["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"] if vf
                    else ["-c:v", "copy"])
            cmd += ["-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}", "-movflags", "+faststart", out]
            proc = await asyncio.create_subprocess_exec(*local_inputs_only(cmd), stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.PIPE)
            try:
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    text = line.decode(errors="ignore").strip()
                    if text.startswith("out_time_ms=") and duration > 0:
                        try:
                            done = int(text.split("=", 1)[1]) / 1e6
                            yield _sse("progress", {"progress": min(done / duration, 1.0)})
                        except ValueError:
                            pass
                err = (await proc.stderr.read()).decode(errors="ignore")
                rc = await proc.wait()
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
            if rc != 0:
                raise RuntimeError("ffmpeg failed: " + err[-800:])
            yield _sse("done", {"file": name})
        except Exception as exc:
            logger.warning("bgm export failed for %s: %s", log_safe(job_id), exc)
            yield _sse("error", {"error": "bgm_export_failed", "stage": "export", "reason": (str(exc) or type(exc).__name__)[-1200:]})
    return _stream(gen())


@router.get("/dub/bgm/download/{job_id}", dependencies=[Depends(reject_cross_site_get)])
def bgm_download(job_id: str, file: str = Query(...)):
    _, job_dir = _job(job_id)
    if not _FILE_RE.fullmatch(file or ""):
        raise HTTPException(status_code=400, detail="Invalid file name")
    path = _inside(job_dir, os.path.join("exports", file))
    if not path:
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(path, media_type="video/mp4", filename=file)
