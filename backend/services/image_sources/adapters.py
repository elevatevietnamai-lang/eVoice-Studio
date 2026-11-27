"""One image from one source. Blocking; the job runner calls these on a thread.

Each adapter gets the exact prompt the user was shown, the reference images
(already copied into a fresh work folder) and a context for cancel/progress,
and returns the path of the image it produced. Nothing else is sent.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from .cli import locate
from .config import SourceConfig, openai_key

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
CODEX_TIMEOUT = 15 * 60
AGY_TIMEOUT = 10 * 60
#: Antigravity's first run can exit before its image subagent writes the file.
AGY_BRAIN_WAIT = 5 * 60
COMFYUI_TIMEOUT = 10 * 60
OPENAI_TIMEOUT = 5 * 60
POLL_SECONDS = 1.0
_CONVERSATION_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

#: Where Antigravity keeps each conversation's files; tests point it elsewhere.
AGY_BRAIN_ROOT: Optional[str] = None

SIZES = {"square": (1024, 1024), "portrait": (1024, 1536), "landscape": (1536, 1024)}


class SourceError(Exception):
    """A failure the page shows as ``images:<code>``."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class Cancelled(Exception):
    pass


@dataclass
class Request:
    source: str
    prompt: str
    workdir: str
    references: list[str] = field(default_factory=list)
    transparent: bool = False
    size: str = "square"


@dataclass
class Context:
    cancel: threading.Event
    progress: Callable[[float, str], None]
    procs: list = field(default_factory=list)

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled()


def agy_brain_root() -> str:
    return AGY_BRAIN_ROOT or os.path.join(os.path.expanduser("~"), ".gemini", "antigravity-cli", "brain")


def newest_image(folder: str, since: float, exclude: Optional[str] = None) -> Optional[str]:
    """The most recent image file under ``folder`` written after ``since``."""
    best: tuple[float, str] | None = None
    if not os.path.isdir(folder):
        return None
    for root, dirs, files in os.walk(folder):
        if exclude and os.path.abspath(root).startswith(os.path.abspath(exclude)):
            dirs[:] = []
            continue
        for name in files:
            if not name.lower().endswith(IMAGE_EXTS):
                continue
            path = os.path.join(root, name)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            if mtime + 2 >= since and (best is None or mtime > best[0]):
                best = (mtime, path)
    return best[1] if best else None


def _stable(path: str, ctx: Context) -> str:
    """Wait until a file stops growing (the CLI may still be writing it)."""
    last = -1
    for _ in range(30):
        ctx.check()
        try:
            size = os.path.getsize(path)
        except OSError:
            size = -1
        if size > 0 and size == last:
            return path
        last = size
        time.sleep(0.5)
    return path


def _child_env() -> dict:
    env = dict(os.environ)
    # The backend's own capabilities never reach a third-party CLI.
    for key in list(env):
        upper = key.upper()
        if upper.startswith(("VOICESTUDIO_", "OMNIVOICE_")) and any(
            word in upper for word in ("TOKEN", "KEY", "SECRET")
        ):
            env.pop(key, None)
        elif upper in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "TRANSLATE_API_KEY"):
            env.pop(key, None)
    env["NO_COLOR"] = "1"
    return env


def _run_cli(argv: list[str], *, cwd: str, stdin_text: str, timeout: float, ctx: Context,
             logs_dir: str, on_poll: Optional[Callable[[str], None]] = None) -> tuple[int, str]:
    """Run a CLI with the prompt on stdin; output goes to a log file, never a pipe."""
    from core.contained_subprocess import spawn_owned

    os.makedirs(logs_dir, exist_ok=True)
    stdin_path = os.path.join(logs_dir, "stdin.txt")
    out_path = os.path.join(logs_dir, "stdout.txt")
    with open(stdin_path, "w", encoding="utf-8") as handle:
        handle.write(stdin_text)
    started = time.monotonic()
    with open(stdin_path, "rb") as stdin, open(out_path, "wb") as out:
        try:
            proc = spawn_owned(argv, cwd=cwd, stdin=stdin, stdout=out, stderr=subprocess.STDOUT,
                               env=_child_env())
        except OSError:
            raise SourceError("start_failed") from None
        ctx.procs.append(proc)
        try:
            while proc.poll() is None:
                if ctx.cancel.is_set():
                    proc.kill()
                    raise Cancelled()
                if time.monotonic() - started > timeout:
                    proc.kill()
                    raise SourceError("timeout")
                if on_poll:
                    on_poll(out_path)
                time.sleep(POLL_SECONDS)
        finally:
            if proc.poll() is None:
                try:
                    proc.kill()
                except OSError:
                    pass
    with open(out_path, "r", encoding="utf-8", errors="replace") as handle:
        return proc.returncode or 0, handle.read(2_000_000)


def run_codex(req: Request, ctx: Context) -> str:
    command = locate("codex")
    if not command:
        raise SourceError("not_installed")
    since = time.time()
    argv = [*command, "exec", "--skip-git-repo-check", "-s", "workspace-write", "--ephemeral",
            "--color", "never", "-C", req.workdir, "-"]
    if req.references:
        argv += ["-i", *req.references]
    ctx.progress(0.1, "running")
    logs = req.workdir + ".logs"
    rc, output = _run_cli(argv, cwd=req.workdir, stdin_text=req.prompt, timeout=CODEX_TIMEOUT,
                          ctx=ctx, logs_dir=logs)
    image = newest_image(req.workdir, since, exclude=os.path.join(req.workdir, "refs"))
    if image:
        return _stable(image, ctx)
    raise SourceError("cli_failed" if rc else "no_image")


def _agy_conversation(text: str) -> Optional[str]:
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        candidates = [event.get("conversation_id")]
        for key in ("result", "step_update"):
            inner = event.get(key)
            if isinstance(inner, dict):
                candidates.append(inner.get("conversation_id"))
        for value in candidates:
            if isinstance(value, str) and _CONVERSATION_ID.match(value):
                return value
    return None


def run_agy(req: Request, ctx: Context) -> str:
    command = locate("agy")
    if not command:
        raise SourceError("not_installed")
    since = time.time()
    argv = [*command, "--mode", "accept-edits", "--input-format", "stream-json",
            "--output-format", "stream-json", "--disable-slash-commands", "-p="]
    message = json.dumps({"event": "user", "message": {"role": "user", "content": req.prompt}})
    found: dict[str, str] = {}

    def poll(out_path: str) -> None:
        if "id" not in found:
            try:
                with open(out_path, "r", encoding="utf-8", errors="replace") as handle:
                    conv = _agy_conversation(handle.read(2_000_000))
            except OSError:
                conv = None
            if conv:
                found["id"] = conv
                ctx.progress(0.3, "running")

    ctx.progress(0.1, "running")
    rc, output = _run_cli(argv, cwd=req.workdir, stdin_text=message + "\n", timeout=AGY_TIMEOUT,
                          ctx=ctx, logs_dir=req.workdir + ".logs", on_poll=poll)
    conversation = found.get("id") or _agy_conversation(output)
    refs = os.path.join(req.workdir, "refs")
    if not conversation:
        image = newest_image(req.workdir, since, exclude=refs)
        if image:
            return _stable(image, ctx)
        raise SourceError("cli_failed" if rc else "no_image")
    brain = os.path.join(agy_brain_root(), conversation)
    ctx.progress(0.6, "waiting")
    deadline = time.monotonic() + AGY_BRAIN_WAIT
    while time.monotonic() < deadline:
        ctx.check()
        image = newest_image(brain, since) or newest_image(req.workdir, since, exclude=refs)
        if image:
            return _stable(image, ctx)
        time.sleep(POLL_SECONDS)
    raise SourceError("timeout")


def _fill_prompt(value, prompt: str, seed: int):
    if isinstance(value, dict):
        return {k: _fill_prompt(v, prompt, seed) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill_prompt(v, prompt, seed) for v in value]
    if isinstance(value, str):
        if value == "{{seed}}":
            return seed
        return value.replace("{{prompt}}", prompt)
    return value


def _comfy(cfg: SourceConfig, method: str, path: str, *, query: str = "", body: Optional[dict] = None,
           timeout: float = 30.0) -> bytes:
    from services.outbound_http import EndpointHTTPError, UnsafeEndpoint, open_trusted_endpoint

    try:
        response = open_trusted_endpoint(
            cfg.comfyui_url, method=method, path=path, query=query, timeout=timeout,
            body=json.dumps(body).encode("utf-8") if body is not None else None,
            content_type="application/json" if body is not None else None,
        )
    except UnsafeEndpoint:
        raise SourceError("comfyui_url") from None
    except EndpointHTTPError:
        raise SourceError("comfyui_failed") from None
    except OSError:
        raise SourceError("comfyui_unreachable") from None
    with response:
        return response.read(64 * 1024 * 1024)


def run_comfyui(req: Request, cfg: SourceConfig, ctx: Context) -> str:
    from urllib.parse import urlencode

    try:
        workflow = json.loads(cfg.comfyui_workflow)
    except ValueError:
        raise SourceError("comfyui_workflow") from None
    if not isinstance(workflow, dict):
        raise SourceError("comfyui_workflow")
    graph = _fill_prompt(workflow, req.prompt, int.from_bytes(os.urandom(4), "big"))
    ctx.progress(0.1, "running")
    reply = json.loads(_comfy(cfg, "POST", "prompt",
                              body={"prompt": graph, "client_id": uuid.uuid4().hex}) or b"{}")
    prompt_id = reply.get("prompt_id") if isinstance(reply, dict) else None
    if not isinstance(prompt_id, str) or not re.match(r"^[0-9a-f-]{36}$", prompt_id):
        raise SourceError("comfyui_failed")
    deadline = time.monotonic() + COMFYUI_TIMEOUT
    while time.monotonic() < deadline:
        if ctx.cancel.is_set():
            try:
                _comfy(cfg, "POST", "interrupt", body={})
            except SourceError:
                pass
            raise Cancelled()
        history = json.loads(_comfy(cfg, "GET", f"history/{prompt_id}") or b"{}")
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if isinstance(entry, dict):
            for node in (entry.get("outputs") or {}).values():
                for image in (node or {}).get("images") or []:
                    name = image.get("filename")
                    if not isinstance(name, str) or not name.lower().endswith(IMAGE_EXTS):
                        continue
                    query = urlencode({"filename": name, "subfolder": image.get("subfolder") or "",
                                       "type": image.get("type") or "output"})
                    data = _comfy(cfg, "GET", "view", query=query, timeout=120.0)
                    ext = os.path.splitext(name)[1].lower()
                    path = os.path.join(req.workdir, "comfyui" + ext)
                    with open(path, "wb") as handle:
                        handle.write(data)
                    return path
            status = entry.get("status") or {}
            if isinstance(status, dict) and status.get("status_str") == "error":
                raise SourceError("comfyui_failed")
        ctx.progress(0.5, "running")
        time.sleep(POLL_SECONDS)
    raise SourceError("timeout")


def run_openai(req: Request, cfg: SourceConfig, ctx: Context) -> str:
    key = openai_key()
    if not key:
        raise SourceError("no_key")
    from openai import OpenAI

    client = OpenAI(api_key=key, base_url=cfg.openai_base_url, timeout=OPENAI_TIMEOUT, max_retries=0)
    width, height = SIZES.get(req.size, SIZES["square"])
    args: dict = {"model": cfg.openai_model, "prompt": req.prompt, "n": 1, "size": f"{width}x{height}"}
    if req.transparent:
        args["background"] = "transparent"
    if cfg.openai_model.startswith("dall-e"):
        args["response_format"] = "b64_json"
        args.pop("background", None)
    ctx.progress(0.2, "running")
    handles = []
    try:
        if req.references:
            handles = [open(path, "rb") for path in req.references]
            result = client.images.edit(image=handles if len(handles) > 1 else handles[0], **args)
        else:
            result = client.images.generate(**args)
    except Exception:  # noqa: BLE001 — provider errors are user-facing state
        raise SourceError("provider_failed") from None
    finally:
        for handle in handles:
            handle.close()
    ctx.check()
    data = getattr(result, "data", None) or []
    b64 = getattr(data[0], "b64_json", None) if data else None
    if not b64:
        raise SourceError("no_image")
    path = os.path.join(req.workdir, "openai.png")
    with open(path, "wb") as handle:
        handle.write(base64.b64decode(b64))
    return path


def run(req: Request, cfg: SourceConfig, ctx: Context) -> str:
    if req.source == "codex":
        return run_codex(req, ctx)
    if req.source == "agy":
        return run_agy(req, ctx)
    if req.source == "comfyui":
        return run_comfyui(req, cfg, ctx)
    if req.source == "openai":
        return run_openai(req, cfg, ctx)
    raise SourceError("off")
