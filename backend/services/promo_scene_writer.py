"""Promo video: an LLM drafts a custom HTML scene from the user's description.

Only the provider the user configured in Settings → LLM Providers (a remote
key, a local Ollama/LM Studio, or a local CLI agent) is ever called, and only
the one the page showed the user before they pressed Write: the request
carries that provider's id and is refused when the active provider changed in
between. Nothing falls back to another provider, and the global
``OMNIVOICE_LLM_BACKEND=off`` switch (or the "off" LLM preference) stops it.

What is sent is the description, the target shape and the UI language. The
reply is untrusted code: it is checked for shape and size here, then the
desktop app runs it only inside the sandboxed scene preview and the offline
renderer, exactly like an imported template. It is never saved or rendered
without the user.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Optional

MAX_DESCRIPTION = 2000
#: Same cap the desktop app puts on a scene's HTML + CSS + JS.
MAX_CODE_BYTES = 256 * 1024
MAX_REPLY_CHARS = 400_000
MAX_PARAMS = 12
MAX_NAME = 60
MAX_LABEL = 40
MAX_TEXT = 200
MIN_SECONDS = 1.0
MAX_SECONDS = 60.0
DEFAULT_TIMEOUT = 180.0

_PARAM_KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_RESERVED = {"width", "height", "duration"}
_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")

Shape = Literal["overlay", "shot"]


class WriterError(Exception):
    """A refusal the page shows as a localized line (``code`` is the key)."""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class WriterProvider:
    provider: Optional[Any]
    ready: bool
    reason: Optional[str]  # None | "disabled" | "no_provider" | "unconfigured"


def resolve() -> WriterProvider:
    """The provider a scene description would go to, resolved like an LLM skill
    that follows the active provider (no per-feature override)."""
    from core import prefs
    from services import llm_providers

    pin = os.environ.get("OMNIVOICE_LLM_BACKEND")
    if pin == "off" or (not pin and prefs.get("llm_backend") == "off"):
        return WriterProvider(None, False, "disabled")
    provider = llm_providers.active_provider()
    if provider is None:
        return WriterProvider(None, False, "no_provider")
    if not llm_providers.is_configured(provider):
        return WriterProvider(provider, False, "unconfigured")
    return WriterProvider(provider, True, None)


def _runs_here(p: Any) -> bool:
    """True when the description stays on this machine: a local engine, a CLI
    agent, or an OpenAI-compatible server on a loopback address."""
    if p.local or p.transport == "cli":
        return True
    from urllib.parse import urlsplit

    from services import llm_providers

    try:
        host = urlsplit(llm_providers.resolve_base_url(p)).hostname or ""
    except Exception:  # noqa: BLE001 — unknown means "not here"
        return False
    return host in ("127.0.0.1", "localhost", "::1")


def describe() -> dict:
    """Client-safe: which provider, whether it runs on this machine, ready."""
    res = resolve()
    p = res.provider
    return {
        "ready": res.ready,
        "reason": res.reason,
        "provider_id": p.id if p is not None else None,
        "display_name": p.display_name if p is not None else None,
        "local": _runs_here(p) if p is not None else None,
        "transport": p.transport if p is not None else None,
    }


def system_prompt(shape: Shape, language: str) -> str:
    stage = (
        "The scene is an OVERLAY drawn over a video: keep html and body transparent and "
        "place the content where an overlay belongs (a lower third, a corner, a band)."
        if shape == "overlay"
        else "The scene is a FULL-FRAME shot of its own: paint the whole frame with a "
        "background (an element with position:absolute; inset:0)."
    )
    return f"""You write one animated scene for a short promo video. The scene is plain HTML, CSS and optional JavaScript that a headless browser renders frame by frame.

{stage}

Hard rules (a scene that breaks one is refused):
- No URLs of any kind: no http(s), no //host, no url(...) to a remote file, no <link>, no <script src>, no @import, no iframes, no fetch or network calls.
- Fonts: only "Inter" and "Oswald" (both bundled), plus generic sans-serif or serif.
- Motion: CSS @keyframes animations or transitions only, or JavaScript through scene.onFrame(function (t) {{ ... }}) where t is the time in seconds. Never setTimeout, setInterval or requestAnimationFrame.
- Size everything in vmin so the scene fits 9:16, 1:1 and 16:9 alike.
- Editable values are params used as {{{{key}}}} placeholders in html, css or js. Keys match ^[a-z][a-z0-9_]{{0,31}}$ and are not width, height or duration. Types: "text" (short words shown in the scene), "color" (#rrggbb), "image" (an image the user picks; use it as <img src="{{{{key}}}}" alt=""> and hide it with img[src=""] {{ display: none; }}). At most {MAX_PARAMS} params.
- {{{{duration}}}}, {{{{width}}}} and {{{{height}}}} are also available (seconds, pixels).
- Write every text value and label in the language with code "{language}".

Answer with exactly one JSON object and nothing else:
{{"name": "short scene name", "duration": seconds between 1 and 60, "html": "...", "css": "...", "js": "...", "params": [{{"key": "title", "type": "text", "label": "Title", "value": "..."}}]}}"""


def _text(value: Any, limit: int) -> str:
    text = value if isinstance(value, str) else ""
    text = " ".join(text.split())
    return text[:limit]


def _params(raw: Any) -> list[dict]:
    params: list[dict] = []
    seen: set[str] = set()
    for entry in raw if isinstance(raw, list) else []:
        if len(params) >= MAX_PARAMS:
            break
        if not isinstance(entry, dict):
            continue
        key, kind = entry.get("key"), entry.get("type")
        if (
            not isinstance(key, str)
            or not _PARAM_KEY.match(key)
            or key in _RESERVED
            or key in seen
            or kind not in ("text", "color", "image")
        ):
            continue
        seen.add(key)
        label = _text(entry.get("label"), MAX_LABEL) or key
        if kind == "text":
            value = _text(entry.get("value"), MAX_TEXT)
        elif kind == "color":
            raw_color = entry.get("value")
            value = raw_color.lower() if isinstance(raw_color, str) and _COLOR.match(raw_color) else "#ffffff"
        else:
            value = ""  # the user picks the image; a model never names a file
        params.append({"key": key, "type": kind, "label": label, "value": value})
    return params


def parse_reply(reply: str) -> dict:
    """The model's answer as a scene draft, or ``WriterError('bad_reply')``."""
    if len(reply) > MAX_REPLY_CHARS:
        raise WriterError("too_large", 422)
    text = _FENCE.sub("", reply.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise WriterError("bad_reply", 422)
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        raise WriterError("bad_reply", 422) from None
    if not isinstance(data, dict) or not isinstance(data.get("html"), str) or not data["html"].strip():
        raise WriterError("bad_reply", 422)
    code = {part: data.get(part) if isinstance(data.get(part), str) else "" for part in ("html", "css", "js")}
    if sum(len(value.encode("utf-8")) for value in code.values()) > MAX_CODE_BYTES:
        raise WriterError("too_large", 422)
    try:
        duration = float(data.get("duration", 5))
    except (TypeError, ValueError):
        duration = 5.0
    if duration != duration:  # NaN
        duration = 5.0
    return {
        "id": None,
        "name": _text(data.get("name"), MAX_NAME),
        "duration": round(min(MAX_SECONDS, max(MIN_SECONDS, duration)), 2),
        **code,
        "params": _params(data.get("params")),
        "assets": [],
    }


def write_scene(description: str, provider_id: str, shape: Shape, language: str,
                timeout: float = DEFAULT_TIMEOUT) -> dict:
    """Ask the confirmed provider for a scene. Blocking: run off the event loop."""
    description = description.strip()
    if not description:
        raise WriterError("empty", 422)
    if len(description) > MAX_DESCRIPTION:
        raise WriterError("too_long", 422)
    res = resolve()
    if not res.ready:
        raise WriterError(res.reason or "disabled", 409)
    if res.provider.id != provider_id:
        # The active provider changed after the page showed it: never send the
        # description somewhere the user did not see.
        raise WriterError("provider_changed", 409)
    from services.llm_backend import OpenAICompatBackend

    backend = OpenAICompatBackend(provider=res.provider)
    try:
        reply = backend.chat(system=system_prompt(shape, language), user=description,
                             timeout=timeout, temperature=0.4)
    except Exception as exc:  # noqa: BLE001 — provider errors are user-facing state
        raise WriterError("provider_failed", 502) from exc
    return parse_reply(reply)
