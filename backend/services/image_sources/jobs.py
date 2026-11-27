"""Background image jobs: one thread per job, progress, cancel, results in memory.

At most ``MAX_RUNNING`` generate at once; the rest wait queued. Finished jobs
are kept for the page to read until ``MAX_KEPT`` newer ones replace them. A
job's work folder is a fresh temp directory removed when it ends.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from . import adapters, library
from .config import SourceConfig

logger = logging.getLogger("omnivoice.images")

MAX_RUNNING = 2
MAX_KEPT = 50
_SLOTS = threading.BoundedSemaphore(MAX_RUNNING)
_LOCK = threading.Lock()


@dataclass
class Job:
    id: str
    source: str
    prompt: str
    status: str = "queued"
    progress: float = 0.0
    stage: str = "queued"
    error: Optional[str] = None
    media: Optional[dict] = None
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancel: threading.Event = field(default_factory=threading.Event)
    procs: list = field(default_factory=list)

    def public(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "status": self.status,
            "progress": round(self.progress, 3),
            "stage": self.stage,
            "error": self.error,
            "media": self.media,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


_JOBS: dict[str, Job] = {}


def get(job_id: str) -> Optional[Job]:
    with _LOCK:
        return _JOBS.get(job_id)


def cancel(job_id: str) -> Optional[Job]:
    job = get(job_id)
    if job is None:
        return None
    job.cancel.set()
    for proc in list(job.procs):
        try:
            proc.kill()
        except OSError:
            pass
    return job


def cancel_all() -> None:
    with _LOCK:
        jobs = list(_JOBS.values())
    for job in jobs:
        if job.status in ("queued", "running"):
            cancel(job.id)


def _prune() -> None:
    done = sorted((j for j in _JOBS.values() if j.finished_at), key=lambda j: j.finished_at or 0)
    while len(done) > MAX_KEPT:
        _JOBS.pop(done.pop(0).id, None)


def _finish(job: Job, status: str, error: Optional[str] = None) -> None:
    job.status = status
    job.error = error
    job.stage = status
    job.finished_at = time.time()
    if status == "done":
        job.progress = 1.0
    with _LOCK:
        _prune()


def _work(job: Job, request: adapters.Request, cfg: SourceConfig, kit_id: Optional[str],
          reference_keys: list[str], tmp_root: str) -> None:
    try:
        with _SLOTS:
            if job.cancel.is_set():
                _finish(job, "cancelled")
                return
            job.status = "running"

            def progress(value: float, stage: str) -> None:
                job.progress = max(job.progress, min(0.95, value))
                job.stage = stage

            ctx = adapters.Context(cancel=job.cancel, progress=progress, procs=job.procs)
            try:
                path = adapters.run(request, cfg, ctx)
                ctx.check()
                job.stage = "saving"
                try:
                    job.media = library.add(path, prompt=job.prompt, source=job.source, kit_id=kit_id,
                                            references=reference_keys,
                                            transparent=request.transparent)
                except ValueError:
                    _finish(job, "failed", "bad_image")
                    return
                _finish(job, "done")
            except adapters.Cancelled:
                _finish(job, "cancelled")
            except adapters.SourceError as exc:
                _finish(job, "failed", exc.code)
            except Exception:  # noqa: BLE001 — the prompt stays out of the log
                logger.exception("image job %s failed", job.id)
                _finish(job, "failed", "internal")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def start(*, source: str, prompt: str, cfg: SourceConfig, references: list[str],
          reference_keys: list[str], transparent: bool, size: str, kit_id: Optional[str]) -> Job:
    """Copy references into a fresh folder and start the job thread."""
    from .prompting import reference_file_name

    tmp_root = tempfile.mkdtemp(prefix="evoice-image-")
    workdir = f"{tmp_root}/work"
    refs_dir = f"{workdir}/refs"
    import os

    os.makedirs(refs_dir)
    copied = []
    for index, path in enumerate(references):
        dest = os.path.join(refs_dir, reference_file_name(index, path))
        shutil.copyfile(path, dest)
        copied.append(dest)
    job = Job(id=uuid.uuid4().hex, source=source, prompt=prompt)
    request = adapters.Request(source=source, prompt=prompt, workdir=workdir, references=copied,
                               transparent=transparent, size=size)
    with _LOCK:
        _JOBS[job.id] = job
    threading.Thread(target=_work, args=(job, request, cfg, kit_id, reference_keys, tmp_root),
                     name=f"image-job-{job.id[:8]}", daemon=True).start()
    return job
