"""Hardcoded-subtitle engine: OCR of burned-in subtitles and their removal.

The engine (``backend/engines/hardsub``) runs in its own uv-managed venv under
``<engines dir>/hardsub/.venv`` so OpenCV / RapidOCR never enter the app's
environment. The backend talks to it through ``cli.py`` subcommands that print
one JSON object per line.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import AsyncIterator, Optional

from core.config import DATA_DIR, get_engines_dir
from services.ffmpeg_utils import find_ffmpeg, find_ffprobe, spawn_subprocess

logger = logging.getLogger("omnivoice.hardsub")

ENGINE_SRC = Path(__file__).resolve().parent.parent / "engines" / "hardsub"
CLI = ENGINE_SRC / "cli.py"
LOCKS = ENGINE_SRC / "locks"  # hash-pinned (uv pip compile --universal --generate-hashes)
_PYTHON_VERSION = "3.11"

_install_lock = asyncio.Lock()


def engine_dir() -> Path:
    return Path(get_engines_dir(DATA_DIR)) / "hardsub"


def venv_dir() -> Path:
    return engine_dir() / ".venv"


def models_dir() -> Path:
    return engine_dir() / "models"


def venv_python() -> Path:
    if sys.platform == "win32":
        return venv_dir() / "Scripts" / "python.exe"
    return venv_dir() / "bin" / "python"


def _marker() -> Path:
    return engine_dir() / ".install-complete"


def is_installed() -> bool:
    return venv_python().is_file() and _marker().is_file()


def _locate_uv() -> Optional[str]:
    from services.sidecar_install import _locate_uv as locate
    return locate()


def _has_nvidia() -> bool:
    if shutil.which("nvidia-smi"):
        return True
    try:
        import torch
        return bool(torch.cuda.is_available() and not getattr(torch.version, "hip", None))
    except Exception:
        return False


def _onnxruntime_lock() -> Path:
    if sys.platform == "darwin":
        return LOCKS / "ort-cpu.lock"  # includes the CoreML EP on Apple Silicon
    if _has_nvidia():
        return LOCKS / "ort-gpu.lock"
    if sys.platform == "win32":
        return LOCKS / "ort-directml.lock"  # AMD / Intel GPUs on Windows
    return LOCKS / "ort-cpu.lock"


# Only what the engine needs; the backend's own environment (API keys, admin tokens) stays behind.
_ENV_ALLOW = ("PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME",
              "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
              "LANG", "LC_ALL", "LD_LIBRARY_PATH", "CUDA_VISIBLE_DEVICES", "CUDA_PATH",
              "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")


def engine_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k.upper() in _ENV_ALLOW}
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    ff = find_ffmpeg()
    fp = find_ffprobe()
    if ff:
        env["HARDSUB_FFMPEG"] = ff
    if fp:
        env["HARDSUB_FFPROBE"] = fp
    if sys.platform != "win32" and venv_python().is_file():
        # faster CUDA lib discovery for pip-installed nvidia-* wheels
        libs = list((venv_dir() / "lib").glob("python3*/site-packages/nvidia/*/lib"))
        if libs:
            env["LD_LIBRARY_PATH"] = os.pathsep.join([*map(str, libs), env.get("LD_LIBRARY_PATH", "")])
    return env


async def _readline(stream, idle_timeout: float) -> bytes:
    """Read one line; an engine silent for `idle_timeout` seconds is treated as hung."""
    return await asyncio.wait_for(stream.readline(), timeout=idle_timeout)


async def _run_logged(cmd: list[str], env: dict, idle_timeout: float,
                      cwd: Optional[str] = None) -> AsyncIterator[str]:
    proc = await spawn_subprocess(*cmd, env=env, cwd=cwd, stdout=asyncio.subprocess.PIPE,
                                  stderr=asyncio.subprocess.STDOUT)
    tail: list[str] = []
    try:
        while True:
            raw = await _readline(proc.stdout, idle_timeout)
            if not raw:
                break
            line = raw.decode("utf-8", "replace").rstrip()
            if line:
                tail = (tail + [line])[-40:]
                yield line
        rc = await proc.wait()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    if rc != 0:
        raise RuntimeError(f"Command failed (exit {rc}): {' '.join(cmd[:3])}…\n" + "\n".join(tail[-15:]))


async def install() -> AsyncIterator[dict]:
    """Create the venv and install the engine. Yields progress events."""
    async with _install_lock:
        if is_installed():
            yield {"type": "done", "installed": True}
            return
        uv = _locate_uv()
        engine_dir().mkdir(parents=True, exist_ok=True)
        from services.sidecar_install import uv_subprocess_env
        env = uv_subprocess_env(Path(get_engines_dir(DATA_DIR)))
        steps = []
        if uv:
            if not venv_python().is_file():
                steps.append(("Creating Python environment",
                              [uv, "venv", "--python", _PYTHON_VERSION, str(venv_dir())]))
            # --no-config: the app repo's own [tool.uv] settings must not leak into the engine install
            pip = [uv, "pip", "install", "--no-config", "--python", str(venv_python()), "--require-hashes"]
        else:
            if not venv_python().is_file():
                steps.append(("Creating Python environment", [sys.executable, "-m", "venv", str(venv_dir())]))
            pip = [str(venv_python()), "-m", "pip", "install", "--require-hashes"]
        steps.append(("Installing OCR and inpainting libraries",
                      [*pip, "-r", str(LOCKS / "requirements.lock")]))
        steps.append(("Installing the GPU runtime", [*pip, "-r", str(_onnxruntime_lock())]))
        for i, (label, cmd) in enumerate(steps):
            yield {"type": "progress", "progress": i / len(steps), "message": label}
            async for line in _run_logged(cmd, env, idle_timeout=1800):
                yield {"type": "log", "message": line}
        yield {"type": "progress", "progress": 0.95, "message": "Checking the engine"}
        info = await probe()
        if not info.get("ocr"):
            raise RuntimeError("OCR library failed to import inside the engine environment.")
        _marker().write_text(json.dumps(info), encoding="utf-8")
        yield {"type": "done", "installed": True, "engine": info}


async def probe() -> dict:
    result: dict = {}
    async for event in run_cli(["probe"], idle_timeout=300):
        if event.get("type") == "result":
            result = event
    return result


def status() -> dict:
    info = {}
    if _marker().is_file():
        try:
            info = json.loads(_marker().read_text(encoding="utf-8"))
        except Exception:
            info = {}
    return {"installed": is_installed(), "engine": info, "path": str(engine_dir())}


async def run_cli(args: list[str], idle_timeout: float = 1800) -> AsyncIterator[dict]:
    """Run the engine CLI and yield its JSON events. Raises on failure."""
    if not venv_python().is_file():
        raise RuntimeError("The hardcoded-subtitle engine is not installed.")
    cmd = [str(venv_python()), "-u", str(CLI), *args]
    proc = await spawn_subprocess(*cmd, env=engine_env(), cwd=str(ENGINE_SRC),
                                  stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    error: Optional[str] = None
    stderr_tail: list[str] = []

    async def drain_stderr():
        while True:
            raw = await proc.stderr.readline()
            if not raw:
                break
            line = raw.decode("utf-8", "replace").rstrip()
            if line:
                stderr_tail.append(line)
                del stderr_tail[:-30]

    stderr_task = asyncio.create_task(drain_stderr())
    rc = None
    try:
        while True:
            # LaMa model download / first CUDA init can be quiet for a while.
            raw = await _readline(proc.stdout, idle_timeout)
            if not raw:
                break
            try:
                event = json.loads(raw.decode("utf-8", "replace"))
            except json.JSONDecodeError:
                continue
            if event.get("type") == "error":
                error = event.get("message") or "Engine error"
                logger.warning("hardsub engine error: %s", event.get("trace", "")[-800:])
                continue
            yield event
        rc = await proc.wait()
    finally:
        # Client disconnect (generator closed) or timeout: never leave the engine running.
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        await asyncio.gather(stderr_task, return_exceptions=True)
    if rc != 0 or error:
        detail = error or "\n".join(stderr_tail[-8:]) or f"exit code {rc}"
        raise RuntimeError(detail)
