"""Local AI music generation (ACE-Step 1.5, MIT) behind a replaceable engine interface.

ACE-Step runs as its own server in a uv-managed environment under
``<engines dir>/acestep``. The backend installs it from a pinned source tarball (no git
needed), pre-downloads the model weights, starts the server on demand on a random
loopback port with a random API key, and stops it when idle or when the backend exits.

Only the DiT is used by default: the 5Hz language model and every LM-driven option stay off
(``thinking`` / CoT / ``use_format`` all default to true on the server, so they are sent
explicitly as false).
"""
from __future__ import annotations

import asyncio
import atexit
import contextlib
import gzip
import hashlib
import json
import logging
import math
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, Callable, Optional, Protocol

import httpx

from core.config import DATA_DIR, get_engines_dir

logger = logging.getLogger("omnivoice.music")

ACESTEP_REVISION = "ca1e85fe9430179831e6bc6be790c332190a3866"
ACESTEP_TARBALL = f"https://codeload.github.com/ace-step/ACE-Step-1.5/tar.gz/{ACESTEP_REVISION}"
# Hugging Face model repo, pinned like the source: the checkpoint folders carry .py files the engine loads.
ACESTEP_MODEL_REPO = "ACE-Step/Ace-Step1.5"
ACESTEP_MODEL_REVISION = "19671f406d603126926c1b7e2adc169acbcade22"
# Runs inside the engine venv. Mirrors acestep's download_main_model, but fetches the pinned
# revision from Hugging Face only (no unpinned ModelScope fallback).
MODEL_DOWNLOAD_CODE = (
    "import sys;from pathlib import Path;import acestep.model_downloader as md;"
    "from huggingface_hub import snapshot_download;"
    "d=Path(sys.argv[1]);d.mkdir(parents=True,exist_ok=True);"
    "snapshot_download(repo_id=sys.argv[2],revision=sys.argv[3],local_dir=str(d)) "
    "if not md.check_main_model_exists(d) else None;"
    "[md._sync_model_code_files(c,d) for c in md.MAIN_MODEL_COMPONENTS if c in md._CHECKPOINT_TO_VARIANT];"
    "print('Music model ready at '+str(d))"
)
# Sum of every file in the pinned model revision (28 files, four large safetensors).
ACESTEP_MODEL_BYTES = 10_092_102_593
# The install's two long steps (uv sync, model download) print almost nothing, so they are
# watched by bytes on disk instead of output lines: progress every few seconds, and a step
# whose bytes stop growing this long is treated as stalled.
_PROGRESS_INTERVAL = 3.0
_STALL_SECONDS = 20 * 60
_NO_LINE_TIMEOUT = 24 * 3600
# SHA-256 of the *uncompressed* tar (git archive output is stable; the gzip layer is not).
ACESTEP_TAR_SHA256 = "c1babe13937c756a10bb9ddc59f989b7cce58bf544ad234720095a5814ffd1db"
_MAX_ARCHIVE_ENTRIES = 20_000
_MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
_PYTHON_VERSION = "3.11"
MIN_SECONDS, MAX_SECONDS = 10, 240
IDLE_STOP_SECONDS = 300
START_TIMEOUT_SECONDS = 900  # first start loads several GB of weights
POLL_TIMEOUT_SECONDS = 1800


def public_reason(exc: BaseException) -> str:
    """What a generation failure may tell the client: our own messages, never raw server or library text."""
    if isinstance(exc, (RuntimeError, ValueError)):
        return (str(exc) or type(exc).__name__)[:300]
    return f"Music generation failed ({type(exc).__name__}). See the backend log."


@dataclass
class MusicRequest:
    prompt: str
    lyrics: str = ""
    instrumental: bool = True
    duration: float = 60.0
    bpm: Optional[int] = None
    key_scale: str = ""
    seed: Optional[int] = None
    vocal_language: str = "en"
    audio_format: str = "wav"

    def seconds(self) -> int:
        return int(max(MIN_SECONDS, min(MAX_SECONDS, round(self.duration))))


class MusicEngine(Protocol):
    """What the rest of the app needs from a music generator."""

    def status(self) -> dict: ...
    def install(self) -> AsyncIterator[dict]: ...
    def generate(self, request: MusicRequest, out_path: str) -> AsyncIterator[dict]: ...
    async def stop(self) -> None: ...


# ───────────────────────────────────────────────────────────────── ACE-Step paths

def engine_dir() -> Path:
    return Path(get_engines_dir(DATA_DIR)) / "acestep"


def source_dir() -> Path:
    return engine_dir() / "src"


def venv_python() -> Path:
    venv = source_dir() / ".venv"
    return venv / "Scripts" / "python.exe" if sys.platform == "win32" else venv / "bin" / "python"


def checkpoints_dir() -> Path:
    return source_dir() / "checkpoints"


def _marker() -> Path:
    return engine_dir() / ".install-complete"


def is_installed() -> bool:
    return venv_python().is_file() and _marker().is_file()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _verify_tar_hash(archive: Path, expected: str) -> None:
    h = hashlib.sha256()
    with gzip.open(archive, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != expected:
        raise RuntimeError("The downloaded ACE-Step archive failed its integrity check.")


def _safe_extract(archive: Path, dest: Path, expected_sha256: Optional[str] = None) -> None:
    """Extract a GitHub tarball, dropping its top-level folder and refusing escapes.

    Verified first (when a hash is given), bounded in entries and bytes, and written to a
    sibling folder that replaces `dest` only after everything extracted, so an interrupted
    run never leaves a half-filled source tree behind.
    """
    if expected_sha256:
        _verify_tar_hash(archive, expected_sha256)
    staging = dest.with_name(dest.name + ".extracting")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    root = staging.resolve()
    total = 0
    try:
        with tarfile.open(archive, "r:gz") as tar:
            members = tar.getmembers()
            if len(members) > _MAX_ARCHIVE_ENTRIES:
                raise RuntimeError("The downloaded archive has too many entries.")
            for member in members:
                parts = Path(member.name).parts[1:]
                if not parts or not (member.isfile() or member.isdir()):
                    continue
                target = root.joinpath(*parts).resolve()
                if root not in target.parents and target != root:
                    raise RuntimeError("The downloaded archive contains an unsafe path.")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                total += member.size
                if total > _MAX_ARCHIVE_BYTES:
                    raise RuntimeError("The downloaded archive is larger than expected.")
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(member)
                if src is not None:
                    with open(target, "wb") as out:
                        shutil.copyfileobj(src, out)
        dest.mkdir(parents=True, exist_ok=True)
        for item in staging.iterdir():
            final = dest / item.name
            if final.is_dir():
                shutil.rmtree(final)
            elif final.exists():
                final.unlink()
            os.replace(item, final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _clean_env(extra: Optional[dict] = None) -> dict:
    """Environment for the engine's own interpreter: nothing from VoiceStudio's venv may leak in."""
    env = os.environ.copy()
    for name in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH", "UV_PROJECT_ENVIRONMENT"):
        env.pop(name, None)
    env.update({"PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
                "ACESTEP_PROJECT_ROOT": str(source_dir()),
                "ACESTEP_CHECKPOINTS_DIR": str(checkpoints_dir())})
    env.update(extra or {})
    return env


# ── install progress


def _dir_bytes(root: Path) -> int:
    """Total size of the files under *root* (0 if it does not exist)."""
    total = 0
    for base, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.stat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return total


def _new_bytes(root: Path, since: float) -> int:
    """Bytes uv has written into its cache since *since*.

    uv downloads and unpacks into ``.tmp*`` files and folders at the cache root, then renames
    them into its buckets, so only entries (at most two levels down) touched after *since* are
    walked; the rest of a multi-GB cache is never read. Sizes come from ``os.stat``: on Windows
    a directory listing reports a file that is still being written as empty.
    """
    total = 0
    try:
        tops = list(os.scandir(root))
    except OSError:
        return 0
    for top in tops:
        try:
            info = os.stat(top.path)
            if info.st_mtime < since:
                continue
            if not top.is_dir():
                total += info.st_size if top.name.startswith(".tmp") else 0
                continue
            if top.name.startswith(".tmp"):
                total += _dir_bytes(Path(top.path))
                continue
            for child in os.scandir(top.path):
                info = os.stat(child.path)
                if info.st_mtime < since:
                    continue
                total += _dir_bytes(Path(child.path)) if child.is_dir() else info.st_size
        except OSError:
            continue
    return total


def _uv_cache_dir(uv: str, env: dict) -> Optional[Path]:
    try:
        out = subprocess.run([uv, "cache", "dir"], env=env, capture_output=True, text=True,
                             timeout=30, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(out) if out else None


async def _watched(lines: AsyncIterator[str], measure: Callable[[], int], *, stage: str,
                   start: float, end: float, total: Optional[int],
                   interval: float = _PROGRESS_INTERVAL,
                   stall_seconds: float = _STALL_SECONDS) -> AsyncIterator[dict]:
    """Relay a step's output lines and, every *interval* seconds, its bytes on disk.

    With a known *total* the bar is ``bytes / total``; without one (uv's download set is not
    known up front) it eases towards *end* and the UI shows the amount, not a percentage.
    Neither new bytes nor new lines for *stall_seconds* aborts the step.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def pump() -> None:
        try:
            async for line in lines:
                await queue.put(("log", line))
            await queue.put(("end", None))
        except Exception as exc:  # noqa: BLE001 - re-raised by the consumer
            await queue.put(("error", exc))

    task = asyncio.create_task(pump())
    shown = start
    last_bytes = -1
    last_change = time.monotonic()
    try:
        while True:
            try:
                kind, value = await asyncio.wait_for(queue.get(), interval)
            except TimeoutError:
                kind, value = "tick", None
            if kind == "end":
                return
            if kind == "error":
                raise value
            if kind == "log":
                last_change = time.monotonic()
                yield {"type": "log", "message": value}
                continue
            done = await asyncio.to_thread(measure)
            if done != last_bytes:
                last_bytes, last_change = done, time.monotonic()
            elif time.monotonic() - last_change > stall_seconds:
                raise RuntimeError(
                    f"The {stage} download made no progress for {int(stall_seconds // 60)} minutes. "
                    "Check the network connection and try again; finished parts are kept."
                )
            fraction = min(done / total, 0.99) if total else 1 - math.exp(-done / (3 * 1024**3))
            # A retried download discards its partial file; the bar never moves backwards.
            shown = max(shown, start + (end - start) * fraction)
            yield {"type": "progress", "progress": shown,
                   "stage": stage, "bytes": done, "total": total}
    finally:
        task.cancel()
        # The step is being torn down either way; its own error was already relayed.
        with contextlib.suppress(BaseException):
            await task


def _log_tail(lines: int = 20) -> str:
    try:
        text = (engine_dir() / "server.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(text.splitlines()[-lines:])


def _unwrap(payload: dict) -> object:
    """ACE-Step wraps every response as {data, code, error}; HTTP 200 alone is not success."""
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected response from the music server.")
    code = payload.get("code")
    if (code is not None and code != 200) or payload.get("error"):
        raise RuntimeError(str(payload.get("error") or f"Music server error {code}")[:400])
    return payload.get("data")


def _task_state(value: object) -> str:
    """`release_task` reports a string ("queued"), `query_result` an int (0/1/2)."""
    if value in (1, "1", "succeeded", "success", "done"):
        return "succeeded"
    if value in (2, "2", "failed", "error"):
        return "failed"
    return "running"


def build_payload(req: MusicRequest) -> dict:
    payload: dict = {
        "prompt": req.prompt.strip() or "calm cinematic background music",
        "lyrics": "[Instrumental]" if req.instrumental else req.lyrics,
        "audio_duration": req.seconds(),
        "vocal_language": req.vocal_language or "en",
        "audio_format": req.audio_format if req.audio_format in ("wav", "mp3", "flac") else "wav",
        "batch_size": 1,
        "inference_steps": 8,
        # These default to true on the server and would invoke the language model.
        "thinking": False,
        "use_cot_caption": False,
        "use_cot_language": False,
        "use_format": False,
        "use_random_seed": req.seed is None,
    }
    if req.seed is not None:
        payload["seed"] = int(req.seed)
    if req.bpm:
        payload["bpm"] = int(req.bpm)
    if req.key_scale:
        payload["key_scale"] = req.key_scale
    return payload


# ───────────────────────────────────────────────────────────────── ACE-Step engine

@dataclass
class _Server:
    proc: object = None
    port: int = 0
    key: str = ""
    last_used: float = 0.0
    busy: int = 0
    reaper: Optional[asyncio.Task] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class AceStepEngine:
    def __init__(self) -> None:
        self._server = _Server()
        self._install_lock = asyncio.Lock()
        atexit.register(self._kill_now)

    # ── status
    def status(self) -> dict:
        running = self._alive()
        return {"engine": "acestep", "installed": is_installed(), "running": running,
                "path": str(engine_dir()), "revision": ACESTEP_REVISION}

    def _alive(self) -> bool:
        proc = self._server.proc
        return proc is not None and proc.poll() is None

    # ── install
    async def install(self) -> AsyncIterator[dict]:
        from services.hardsub import _run_logged
        from services.sidecar_install import _locate_uv, uv_subprocess_env

        async with self._install_lock:
            if is_installed():
                yield {"type": "done", "installed": True}
                return
            uv = _locate_uv()
            if not uv:
                raise RuntimeError("uv was not found; reinstall VoiceStudio or install uv.")
            engines = Path(get_engines_dir(DATA_DIR))
            env = _clean_env(uv_subprocess_env(engines))
            src = source_dir()
            if not (src / "pyproject.toml").is_file():
                yield {"type": "progress", "progress": 0.02, "stage": "source",
                       "message": "Downloading ACE-Step source"}
                engine_dir().mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(dir=engine_dir()) as tmp:
                    archive = Path(tmp) / "src.tar.gz"
                    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0),
                                                 follow_redirects=True) as client:
                        async with client.stream("GET", ACESTEP_TARBALL) as r:
                            r.raise_for_status()
                            with open(archive, "wb") as f:
                                async for chunk in r.aiter_bytes():
                                    f.write(chunk)
                    await asyncio.to_thread(_safe_extract, archive, src, ACESTEP_TAR_SHA256)
            yield {"type": "progress", "progress": 0.05, "stage": "engine", "bytes": 0, "total": None,
                   "message": "Installing the music engine (several GB, can take a while)"}
            sync = [uv, "sync", "--locked", "--python", _PYTHON_VERSION]
            cache = await asyncio.to_thread(_uv_cache_dir, uv, env)
            since = time.time() - 2
            engine_bytes = (lambda: _new_bytes(cache, since)) if cache else (lambda: 0)
            async for event in _watched(_run_logged(sync, env, _NO_LINE_TIMEOUT, cwd=str(src)),
                                        engine_bytes, stage="engine", start=0.05, end=0.4, total=None):
                yield event
            yield {"type": "progress", "progress": 0.4, "stage": "model", "bytes": 0,
                   "total": ACESTEP_MODEL_BYTES, "message": "Downloading the music model (~10 GB)"}
            cmd = [str(venv_python()), "-u", "-c", MODEL_DOWNLOAD_CODE, str(checkpoints_dir()),
                   ACESTEP_MODEL_REPO, ACESTEP_MODEL_REVISION]
            # huggingface_hub's bars redraw with \r and no newline; over a 10 GB download that
            # overflows the line reader (asyncio's 64 KiB limit) and aborts the install.
            model_env = {**env, "HF_HUB_DISABLE_PROGRESS_BARS": "1"}
            async for event in _watched(_run_logged(cmd, model_env, _NO_LINE_TIMEOUT, cwd=str(src)),
                                        lambda: _dir_bytes(checkpoints_dir()), stage="model",
                                        start=0.4, end=0.99, total=ACESTEP_MODEL_BYTES):
                yield event
            _marker().write_text(json.dumps({"revision": ACESTEP_REVISION, "model_revision": ACESTEP_MODEL_REVISION,
                                                  "at": time.time()}), encoding="utf-8")
            yield {"type": "done", "installed": True}

    # ── lifecycle
    async def _ensure_running(self) -> tuple[str, str]:
        srv = self._server
        async with srv.lock:
            if not is_installed():
                raise RuntimeError("The music engine is not installed yet.")
            if not self._alive():
                from core.contained_subprocess import spawn_owned
                srv.port, srv.key = _free_port(), secrets.token_urlsafe(24)
                env = _clean_env({"ACESTEP_API_HOST": "127.0.0.1", "ACESTEP_API_PORT": str(srv.port),
                                  "ACESTEP_API_KEY": srv.key, "ACESTEP_INIT_LLM": "false",
                                  "ACESTEP_LM_BACKEND": "pt",
                                  "ACESTEP_TMPDIR": str(engine_dir() / "tmp")})
                logger.info("starting ACE-Step on 127.0.0.1:%s", srv.port)
                log_file = open(engine_dir() / "server.log", "wb")
                try:
                    srv.proc = spawn_owned([str(venv_python()), "-m", "acestep.api_server"], env=env,
                                           cwd=str(source_dir()), stdout=log_file, stderr=subprocess.STDOUT)
                finally:
                    log_file.close()  # the child keeps its own handle
                await self._wait_healthy()
            srv.last_used = time.monotonic()
            if srv.reaper is None or srv.reaper.done():
                srv.reaper = asyncio.create_task(self._reap_idle())
            return f"http://127.0.0.1:{srv.port}", srv.key

    async def _wait_healthy(self) -> None:
        srv = self._server
        deadline = time.monotonic() + START_TIMEOUT_SECONDS
        async with httpx.AsyncClient(timeout=3.0) as client:
            while time.monotonic() < deadline:
                if not self._alive():
                    raise RuntimeError("The music server exited while starting.\n" + _log_tail())
                try:
                    r = await client.get(f"http://127.0.0.1:{srv.port}/health",
                                         headers={"Authorization": f"Bearer {srv.key}"})
                    if r.status_code == 200:
                        _unwrap(r.json())
                        return
                except (httpx.HTTPError, ValueError, RuntimeError):
                    pass
                await asyncio.sleep(2.0)
        await self.stop()
        raise RuntimeError("The music server did not become ready in time.\n" + _log_tail())

    async def _reap_idle(self) -> None:
        srv = self._server
        while self._alive():
            await asyncio.sleep(30)
            if srv.busy == 0 and time.monotonic() - srv.last_used > IDLE_STOP_SECONDS:
                logger.info("stopping idle ACE-Step server")
                await self.stop()
                return

    def is_busy(self) -> bool:
        return bool(self._server and self._server.busy)

    async def stop(self) -> None:
        await asyncio.to_thread(self._kill_now)

    def _kill_now(self) -> None:
        proc = self._server.proc
        self._server.proc = None
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # ── generation
    async def generate(self, request: MusicRequest, out_path: str) -> AsyncIterator[dict]:
        yield {"type": "progress", "progress": 0.0, "message": "Starting the music engine"}
        base, key = await self._ensure_running()
        srv = self._server
        srv.busy += 1
        finished = False
        try:
            headers = {"Authorization": f"Bearer {key}"}
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, read=600.0), headers=headers) as client:
                r = await client.post(f"{base}/release_task", json=build_payload(request))
                if r.status_code >= 400:
                    logger.warning("music server refused the task: %s", r.text[:300])
                    raise RuntimeError(f"Music generation was refused (HTTP {r.status_code}).")
                data = _unwrap(r.json()) or {}
                task_id = data.get("task_id") if isinstance(data, dict) else None
                if not task_id:
                    raise RuntimeError("The music server did not return a task id.")
                yield {"type": "progress", "progress": 0.1, "message": "Generating"}
                waited = 0.0
                missing = 0
                transient = 0
                while True:
                    if waited > POLL_TIMEOUT_SECONDS:
                        raise RuntimeError("Music generation took too long and was stopped.")
                    await asyncio.sleep(2.0)
                    waited += 2.0
                    srv.last_used = time.monotonic()
                    try:
                        q = await client.post(f"{base}/query_result", json={"task_id_list": [task_id]})
                        items = _unwrap(q.json()) or []
                        transient = 0
                    except httpx.TransportError as exc:
                        # The server can stall briefly while it loads weights; only give up on a streak.
                        transient += 1
                        if transient >= 10:
                            raise RuntimeError(f"Lost the connection to the music server ({type(exc).__name__}).")
                        continue
                    item = next((i for i in items if isinstance(i, dict) and i.get("task_id") == task_id), None)
                    missing = 0 if item else missing + 1
                    if missing >= 15:
                        raise RuntimeError("The music server lost the task (it may have restarted).")
                    state = _task_state(item.get("status") if item else 0)
                    if state == "failed":
                        logger.warning("music task failed: %s", str(item.get("result") or "")[:300] if item else "")
                        raise RuntimeError("Music generation failed on the music server. See the backend log.")
                    if state == "succeeded":
                        results = item.get("result")
                        results = json.loads(results) if isinstance(results, str) else (results or [])
                        file_url = next((x.get("file") for x in results if isinstance(x, dict) and x.get("file")), "")
                        await _download(client, base, file_url, out_path)
                        finished = True
                        yield {"type": "done", "seconds": request.seconds()}
                        return
                    yield {"type": "progress", "progress": min(0.1 + waited / 240.0, 0.95), "message": "Generating"}
        finally:
            srv.busy -= 1
            srv.last_used = time.monotonic()
            if not finished and srv.busy == 0:
                # The client left or the job failed mid-run: the server has no cancel call,
                # so stop it to free the GPU instead of finishing a track nobody wants.
                self._kill_now()


async def _download(client: httpx.AsyncClient, base: str, file_url: str, out_path: str) -> None:
    # Only fetch what the server itself serves; never follow an arbitrary URL from a payload.
    if not file_url.startswith("/v1/audio"):
        raise RuntimeError("Music generation finished without a downloadable file.")
    r = await client.get(f"{base}{file_url}")
    r.raise_for_status()
    tmp = out_path + ".part"
    with open(tmp, "wb") as f:
        f.write(r.content)
    os.replace(tmp, out_path)


_engine: Optional[AceStepEngine] = None


def get_engine() -> AceStepEngine:
    global _engine
    if _engine is None:
        _engine = AceStepEngine()
    return _engine
