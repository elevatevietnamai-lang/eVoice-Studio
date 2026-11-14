"""Local AI music generation (ACE-Step 1.5, MIT) behind a replaceable engine interface.

ACE-Step runs as its own server in a uv-managed environment under
``<engines dir>/acestep``. The backend installs it from a pinned source tarball (no git
needed), pre-downloads the model weights, starts the server on demand on a random
loopback port with a random API key, and stops it when idle or when the backend exits.

Only the DiT is used by default: the 5Hz language model and every LM-driven option stay off
(``thinking`` / CoT / ``use_format`` all default to true on the server, so they are sent
explicitly as false). A request that opts into Thinking runs on a server started with the LM;
the server mode always matches the request, because a loaded LM also fills missing metadata
for requests that did not ask for it.
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
import re
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

# ── 5Hz language model ("Thinking"): writes the song's audio codes before the DiT renders it.
# The 1.7B LM ships in the main model repo above. ACE-Step only loads it on GPUs above 12 GB;
# 6-12 GB GPUs get the 0.6B LM, an optional pinned download (MIT, checked 2026-11-14).
LM_LARGE = "acestep-5Hz-lm-1.7B"
LM_SMALL = "acestep-5Hz-lm-0.6B"
LM_SMALL_REPO = "ACE-Step/acestep-5Hz-lm-0.6B"
LM_SMALL_REVISION = "148d8ea0225bdab342ee1ae3a354275ccd60ca80"
LM_SMALL_BYTES = 1_372_702_240
LM_SMALL_DOWNLOAD_CODE = (
    "import sys;from pathlib import Path;from huggingface_hub import snapshot_download;"
    "d=Path(sys.argv[1]);d.mkdir(parents=True,exist_ok=True);"
    "snapshot_download(repo_id=sys.argv[2],revision=sys.argv[3],local_dir=str(d));"
    "print('Language model ready at '+str(d))"
)
# Runs inside the engine venv with ACE-Step's own GPU tiering, so the answer is exactly the LM
# the server will load at startup (a different answer there would make it download one itself).
LM_PROBE_CODE = (
    "import json;from acestep.gpu_config import get_gpu_config,is_lm_model_supported as s;"
    "c=get_gpu_config();"
    "print('LMPROBE'+json.dumps({'memory_gb':round(float(c.gpu_memory_gb),2),'tier':c.tier,"
    f"'large':s('{LM_LARGE}',c)[0],'small':s('{LM_SMALL}',c)[0]}}))"
)
# Debug overrides ACE-Step honours for its GPU tiering; never inherited from the user's shell.
_VRAM_DEBUG_ENV = ("MAX_CUDA_VRAM", "MAX_MPS_VRAM", "MAX_XPU_VRAM")

# What ACE-Step accepts (acestep/constants.py at ACESTEP_REVISION).
VOCAL_LANGUAGES = (
    "ar", "az", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi",
    "hr", "ht", "hu", "id", "is", "it", "ja", "ko", "la", "lt", "ms", "ne", "nl", "no", "pa", "pl",
    "pt", "ro", "ru", "sa", "sk", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur", "vi",
    "yue", "zh", "unknown",
)
TIME_SIGNATURES = ("2", "3", "4", "6")
_KEY_RE = re.compile(r"^([A-Ga-g])([#b♯♭]?)\s*(major|minor|maj|min|m)?$", re.IGNORECASE)


def normalize_key_scale(value: str) -> str:
    """'f# MINOR', 'Bbm', 'C' -> ACE-Step's 'F# minor', 'Bb minor', 'C major'; '' stays ''."""
    text = (value or "").strip()
    if not text:
        return ""
    match = _KEY_RE.match(text)
    if not match:
        raise ValueError("Unknown key. Use a note and a mode, for example 'C major' or 'F# minor'.")
    note, accidental, mode = match.groups()
    accidental = {"♯": "#", "♭": "b"}.get(accidental, accidental)
    mode = (mode or "major").lower()
    return f"{note.upper()}{accidental} {'minor' if mode in ('minor', 'min', 'm') else 'major'}"


class MusicLmUnavailable(RuntimeError):
    """Thinking was asked for but this machine cannot run a language model as installed.

    ``code`` is ``music_lm_unsupported`` (not enough GPU memory) or ``music_lm_missing``
    (the 0.6B LM this GPU needs is not downloaded yet).
    """

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


class MusicModeBusy(RuntimeError):
    """Switching the server in or out of Thinking would interrupt a running track."""
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
    time_signature: str = ""
    # Thinking: the 5Hz LM writes the audio codes and fills a missing BPM, key or time signature.
    thinking: bool = False

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


def lm_dir(model: str) -> Path:
    return checkpoints_dir() / model


def lm_on_disk(model: str) -> bool:
    folder = lm_dir(model)
    return folder.is_dir() and any(folder.glob("*.safetensors"))


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
    for name in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH", "UV_PROJECT_ENVIRONMENT", *_VRAM_DEBUG_ENV):
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


# ── resumable torch wheel
# The CUDA torch wheel is ~3 GB and uv restarts a dropped transfer from byte 0 on every retry, so on
# an unstable connection the engine never installs. Like the app runtime's setup
# (electron/src/main/runtime-wheel.ts), the locked wheel is fetched here with HTTP Range, resuming
# across retries and app restarts, verified against the lock's SHA-256, and installed from the
# local file after uv has synced everything else.

_WHEEL_ATTEMPTS = 80
_WHEEL_IDLE_ATTEMPTS = 8
_WHEEL_READ_TIMEOUT = 60.0


@dataclass(frozen=True)
class LockedWheel:
    name: str
    version: str
    filename: str
    url: str
    sha256: str


def _wheel_tag() -> Optional[re.Pattern]:
    """The cp311 wheel tag for this host, or None where torch is small or not CUDA (macOS)."""
    import platform

    machine = platform.machine().lower()
    if sys.platform == "win32":
        return re.compile(r"-cp311-cp311-win_amd64\.whl$")
    if sys.platform.startswith("linux") and machine in ("x86_64", "amd64"):
        return re.compile(r"-cp311-cp311-manylinux_[0-9_]+_x86_64\.whl$")
    return None


def _planned_version(dry_run_output: str, name: str) -> Optional[str]:
    """The version `uv sync --dry-run` would install for *name* (None if already satisfied)."""
    match = re.search(rf"^\s*\+ {re.escape(name)}==(\S+)", dry_run_output, re.MULTILINE)
    return match.group(1) if match else None


def _locked_wheel(lock: str, name: str, version: str, tag: re.Pattern) -> Optional[LockedWheel]:
    """The wheel uv.lock pins for *name* *version* on this host, with its URL and SHA-256."""
    from urllib.parse import unquote

    for block in lock.replace("\r\n", "\n").split("\n[[package]]\n"):
        head = re.match(r'name = "([^"]+)"\nversion = "([^"]+)"\nsource = \{ registry = "https://', block)
        if not head or head.group(1) != name or head.group(2) != version:
            continue
        for url, digest in re.findall(r'\{ url = "(https://[^"]+)", hash = "sha256:([0-9a-f]{64})"', block):
            filename = unquote(url.rsplit("/", 1)[-1])
            if tag.search(filename):
                return LockedWheel(name, version, filename, url, digest)
    return None


def _plan_torch(uv: str, env: dict, src: Path) -> Optional[LockedWheel]:
    """The torch wheel this install still has to download, when it can be fetched resumably."""
    tag = _wheel_tag()
    if tag is None:
        return None
    try:
        dry = subprocess.run([uv, "sync", "--locked", "--python", _PYTHON_VERSION, "--dry-run"],
                             env=env, cwd=str(src), capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=600, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    version = _planned_version(dry.stdout + dry.stderr, "torch")
    if not version:
        return None
    try:
        lock = (src / "uv.lock").read_text(encoding="utf-8")
    except OSError:
        return None
    return _locked_wheel(lock, "torch", version, tag)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _transient(exc: BaseException) -> bool:
    return isinstance(exc, (httpx.TransportError, _Interrupted))


class _Interrupted(Exception):
    """The server closed the transfer early or answered with a retryable status."""


async def _download_wheel(wheel: LockedWheel, folder: Path, *, interval: float = _PROGRESS_INTERVAL,
                          backoff: float = 1.0) -> AsyncIterator[tuple[int, int]]:
    """Download *wheel* into *folder*, resuming ``<file>.part`` across attempts and restarts.

    Yields ``(bytes on disk, total)`` every *interval* seconds; the verified wheel is left at
    ``folder / wheel.filename``.
    """
    if not wheel.url.startswith("https://"):
        raise RuntimeError("Engine wheels are only downloaded over HTTPS.")
    folder.mkdir(parents=True, exist_ok=True)
    final = folder / wheel.filename
    part = folder / (wheel.filename + ".part")
    if final.is_file() and await asyncio.to_thread(_sha256_file, final) == wheel.sha256:
        return
    final.unlink(missing_ok=True)
    timeout = httpx.Timeout(30.0, read=_WHEEL_READ_TIMEOUT)
    rechecked = False
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        while True:
            idle = 0
            for attempt in range(1, _WHEEL_ATTEMPTS + 1):
                have = part.stat().st_size if part.exists() else 0
                try:
                    headers = {"Range": f"bytes={have}-"} if have else {}
                    async with client.stream("GET", wheel.url, headers=headers) as response:
                        if response.status_code == 416:
                            break  # the part already holds everything; the hash decides
                        if response.status_code in (429,) or response.status_code >= 500:
                            raise _Interrupted(f"server answered {response.status_code}")
                        if response.status_code not in (200, 206):
                            raise RuntimeError(f"Downloading {wheel.filename} failed ({response.status_code}).")
                        resumed = response.status_code == 206 and have > 0
                        offset = have if resumed else 0
                        span = re.search(r"/(\d+)$", response.headers.get("content-range", ""))
                        length = int(response.headers.get("content-length") or 0)
                        total = int(span.group(1)) if span else (offset + length if length else 0)
                        received = offset
                        last = time.monotonic()
                        with open(part, "ab" if resumed else "wb") as out:
                            async for chunk in response.aiter_bytes():
                                out.write(chunk)
                                received += len(chunk)
                                if time.monotonic() - last >= interval:
                                    last = time.monotonic()
                                    yield received, total
                        yield received, total
                        if total and received < total:
                            raise _Interrupted("connection closed early")
                        break
                except Exception as exc:  # only transient errors are retried
                    if not _transient(exc):
                        raise
                    grown = (part.stat().st_size if part.exists() else 0) > have
                    idle = 0 if grown else idle + 1
                    if idle >= _WHEEL_IDLE_ATTEMPTS:
                        raise RuntimeError(
                            f"The connection keeps dropping while downloading {wheel.filename}. "
                            "Check the network and try again: the download continues where it stopped."
                        ) from exc
                    logger.info("engine wheel download interrupted (%s); retrying", exc)
                    await asyncio.sleep(backoff * min(attempt, 10))
            else:
                raise RuntimeError(f"Could not finish downloading {wheel.filename}.")
            if await asyncio.to_thread(_sha256_file, part) == wheel.sha256:
                os.replace(part, final)
                return
            part.unlink(missing_ok=True)
            if rechecked:
                raise RuntimeError(f"The downloaded {wheel.filename} does not match its locked hash.")
            rechecked = True


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
        # These default to true on the server and would invoke the language model. Thinking turns
        # on code generation only; the caption and language stay exactly what the user wrote.
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
    if req.time_signature in TIME_SIGNATURES:
        payload["time_signature"] = req.time_signature
    if req.thinking:
        # The request model defaults to vllm, which the engine does not install on any platform.
        payload["thinking"] = True
        payload["lm_backend"] = "pt"
    return payload


# ───────────────────────────────────────────────────────────────── ACE-Step engine

@dataclass
class _Server:
    proc: object = None
    port: int = 0
    key: str = ""
    last_used: float = 0.0
    busy: int = 0
    # The LM this server loaded at startup, or None for a DiT-only server.
    llm: Optional[str] = None
    reaper: Optional[asyncio.Task] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class AceStepEngine:
    def __init__(self) -> None:
        self._server = _Server()
        self._install_lock = asyncio.Lock()
        self._probe: Optional[dict] = None
        atexit.register(self._kill_now)

    # ── status
    def status(self) -> dict:
        running = self._alive()
        return {"engine": "acestep", "installed": is_installed(), "running": running,
                "path": str(engine_dir()), "revision": ACESTEP_REVISION}

    def _alive(self) -> bool:
        proc = self._server.proc
        return proc is not None and proc.poll() is None

    # ── language model (Thinking)
    async def hardware(self) -> dict:
        """ACE-Step's own GPU tiering, measured once in the engine's interpreter."""
        if self._probe is None:
            if not is_installed():
                raise RuntimeError("The music engine is not installed yet.")
            proc = await asyncio.create_subprocess_exec(
                str(venv_python()), "-c", LM_PROBE_CODE, cwd=str(source_dir()), env=_clean_env(),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                raise RuntimeError("Measuring the GPU for the music language model timed out.")
            text = out.decode("utf-8", "replace")
            line = next((ln for ln in text.splitlines() if ln.startswith("LMPROBE")), "")
            if not line:
                logger.warning("music LM probe failed: %s", text[-500:])
                raise RuntimeError("Could not measure the GPU for the music language model. See the backend log.")
            self._probe = json.loads(line[len("LMPROBE"):])
        return self._probe

    async def lm_status(self) -> dict:
        """Which LM Thinking would use here, and whether it is ready."""
        hw = await self.hardware()
        model = LM_LARGE if hw.get("large") else LM_SMALL if hw.get("small") else None
        ready = bool(model and lm_on_disk(model))
        return {"model": model, "ready": ready,
                "download_bytes": LM_SMALL_BYTES if model == LM_SMALL and not ready else 0,
                "memory_gb": hw.get("memory_gb"), "tier": hw.get("tier")}

    async def _lm_for_request(self) -> str:
        info = await self.lm_status()
        if not info["model"]:
            raise MusicLmUnavailable(
                "Thinking needs a GPU with more than 6 GB of memory. Turn Thinking off to generate.",
                "music_lm_unsupported")
        if not info["ready"]:
            raise MusicLmUnavailable(
                "Thinking on this GPU uses the small language model. Download it first (about 1.4 GB).",
                "music_lm_missing")
        return info["model"]

    async def install_lm(self) -> AsyncIterator[dict]:
        """Download the pinned 0.6B LM for 6-12 GB GPUs (the 1.7B LM ships with the main model)."""
        from services.hardsub import _run_logged

        async with self._install_lock:
            info = await self.lm_status()
            if info["model"] != LM_SMALL:
                raise RuntimeError("This GPU does not use the small language model.")
            if not info["ready"]:
                yield {"type": "progress", "progress": 0.0, "stage": "model", "bytes": 0,
                       "total": LM_SMALL_BYTES, "message": "Downloading the music language model"}
                target = lm_dir(LM_SMALL)
                cmd = [str(venv_python()), "-u", "-c", LM_SMALL_DOWNLOAD_CODE, str(target),
                       LM_SMALL_REPO, LM_SMALL_REVISION]
                env = _clean_env({"HF_HUB_DISABLE_PROGRESS_BARS": "1"})
                async for event in _watched(_run_logged(cmd, env, _NO_LINE_TIMEOUT, cwd=str(source_dir())),
                                            lambda: _dir_bytes(target), stage="model",
                                            start=0.0, end=0.99, total=LM_SMALL_BYTES):
                    yield event
                if not lm_on_disk(LM_SMALL):
                    raise RuntimeError("The language model download finished without its weights.")
            yield {"type": "done", "installed": True}

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
            torch = await asyncio.to_thread(_plan_torch, uv, env, src)
            if torch:
                sync += ["--no-install-package", "torch"]
            cache = await asyncio.to_thread(_uv_cache_dir, uv, env)
            since = time.time() - 2
            engine_bytes = (lambda: _new_bytes(cache, since)) if cache else (lambda: 0)
            async for event in _watched(_run_logged(sync, env, _NO_LINE_TIMEOUT, cwd=str(src)),
                                        engine_bytes, stage="engine", start=0.05,
                                        end=0.2 if torch else 0.4, total=None):
                yield event
            if torch:
                wheels = engine_dir() / ".wheels"
                async for done, size in _download_wheel(torch, wheels):
                    fraction = min(done / size, 1.0) if size else 0.0
                    yield {"type": "progress", "progress": 0.2 + 0.18 * fraction, "stage": "engine",
                           "bytes": done, "total": size or None,
                           "message": f"Downloading {torch.filename}"}
                install = [uv, "pip", "install", "--python", str(venv_python()), "--no-deps",
                           "--no-index", "--find-links", str(wheels), f"torch=={torch.version}"]
                async for line in _run_logged(install, env, _NO_LINE_TIMEOUT, cwd=str(src)):
                    yield {"type": "log", "message": line}
                (wheels / torch.filename).unlink(missing_ok=True)
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
    async def _ensure_running(self, llm: Optional[str] = None) -> tuple[str, str]:
        srv = self._server
        async with srv.lock:
            if not is_installed():
                raise RuntimeError("The music engine is not installed yet.")
            if self._alive() and srv.llm != llm:
                if srv.busy:
                    raise MusicModeBusy("Another track is still generating. Try again when it finishes.")
                logger.info("restarting ACE-Step %s the language model", "with" if llm else "without")
                await asyncio.to_thread(self._kill_now)
            if not self._alive():
                from core.contained_subprocess import spawn_owned
                srv.port, srv.key = _free_port(), secrets.token_urlsafe(24)
                extra = {"ACESTEP_API_HOST": "127.0.0.1", "ACESTEP_API_PORT": str(srv.port),
                         "ACESTEP_API_KEY": srv.key, "ACESTEP_INIT_LLM": "false",
                         "ACESTEP_LM_BACKEND": "pt",
                         "ACESTEP_TMPDIR": str(engine_dir() / "tmp")}
                if llm:
                    # `llm` is on disk and is the model ACE-Step's own tiering (total GPU memory,
                    # fixed per machine) loads, so startup needs no download. Its fallback would
                    # probe google.com and fetch unpinned from Hugging Face, then ModelScope; the
                    # fixed source skips the probe and the dead proxy makes any fetch fail fast.
                    # Eager init loads the LM before /health answers, so the log check is final.
                    dead = "http://127.0.0.1:9"
                    extra.update({"ACESTEP_INIT_LLM": "true", "ACESTEP_LM_MODEL_PATH": llm,
                                  "ACESTEP_NO_INIT": "false",
                                  "ACESTEP_DOWNLOAD_SOURCE": "huggingface", "HF_HUB_OFFLINE": "1",
                                  "HTTP_PROXY": dead, "HTTPS_PROXY": dead, "ALL_PROXY": dead,
                                  "http_proxy": dead, "https_proxy": dead, "all_proxy": dead,
                                  "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"})
                env = _clean_env(extra)
                srv.llm = llm
                logger.info("starting ACE-Step on 127.0.0.1:%s", srv.port)
                log_file = open(engine_dir() / "server.log", "wb")
                try:
                    srv.proc = spawn_owned([str(venv_python()), "-m", "acestep.api_server"], env=env,
                                           cwd=str(source_dir()), stdout=log_file, stderr=subprocess.STDOUT)
                finally:
                    log_file.close()  # the child keeps its own handle
                await self._wait_healthy()
                if llm:
                    self._check_lm_loaded(llm)
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

    def _check_lm_loaded(self, llm: str) -> None:
        """Startup reports the LM it really loaded; anything else must not run as Thinking."""
        log = _log_tail(400)
        if f"LLM model loaded: {llm}" in log and "Falling back to supported LM model" not in log:
            return
        logger.warning("music LM did not load as %s:\n%s", llm, _log_tail(40))
        self._kill_now()
        raise RuntimeError("The music language model could not be loaded. Turn Thinking off, "
                           "or free GPU memory and try again.")

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
        llm = await self._lm_for_request() if request.thinking else None
        yield {"type": "progress", "progress": 0.0, "message": "Starting the music engine"}
        base, key = await self._ensure_running(llm)
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
                        first = next((x for x in results if isinstance(x, dict) and x.get("file")), {})
                        await _download(client, base, first.get("file", ""), out_path)
                        finished = True
                        yield {"type": "done", "seconds": request.seconds(), **result_details(first)}
                        return
                    yield {"type": "progress", "progress": min(0.1 + waited / 240.0, 0.95), "message": "Generating"}
        finally:
            srv.busy -= 1
            srv.last_used = time.monotonic()
            if not finished and srv.busy == 0:
                # The client left or the job failed mid-run: the server has no cancel call,
                # so stop it to free the GPU instead of finishing a track nobody wants.
                self._kill_now()


def result_details(result: dict) -> dict:
    """The seed the server really used and the metadata it settled on (the LM may fill these)."""
    seed = None
    first = str(result.get("seed_value") or "").split(",")[0].strip()
    if first.lstrip("-").isdigit():
        seed = int(first)
    metas = result.get("metas") if isinstance(result.get("metas"), dict) else {}
    bpm = metas.get("bpm")
    return {"seed": seed if seed is not None and 0 <= seed <= 2**31 - 1 else None,
            "bpm": int(bpm) if isinstance(bpm, (int, float)) and 30 <= bpm <= 300 else None,
            "key_scale": str(metas.get("keyscale") or "")[:24],
            "time_signature": str(metas.get("timesignature") or "")[:4]}


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
