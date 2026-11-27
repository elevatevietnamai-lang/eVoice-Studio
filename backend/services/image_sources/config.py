"""Which image source is selected, and its settings. Off unless the user picks one."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional
from urllib.parse import urlsplit

SOURCE_IDS = ("codex", "agy", "comfyui", "openai")
PREFS_KEY = "image_sources"
OPENAI_KEY_SECRET = "image_sources.openai_key"
DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188"
DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-image-1"
MAX_WORKFLOW_BYTES = 512 * 1024

#: Rough seconds per image, shown before a generation (measured 2026-11-27).
ESTIMATE_SECONDS = {"codex": 120, "agy": 60, "comfyui": 30, "openai": 30}


@dataclass
class SourceConfig:
    active: str = "off"
    comfyui_url: str = DEFAULT_COMFYUI_URL
    #: ComfyUI workflow in API format; ``{{prompt}}`` marks where the prompt goes.
    comfyui_workflow: str = ""
    openai_base_url: str = DEFAULT_OPENAI_BASE
    openai_model: str = DEFAULT_OPENAI_MODEL


def load_config() -> SourceConfig:
    from core import prefs

    raw = prefs.get(PREFS_KEY) or {}
    if not isinstance(raw, dict):
        raw = {}
    cfg = SourceConfig()
    for field in asdict(cfg):
        value = raw.get(field)
        if isinstance(value, str):
            setattr(cfg, field, value)
    if cfg.active not in SOURCE_IDS:
        cfg.active = "off"
    return cfg


def save_config(cfg: SourceConfig) -> None:
    from core import prefs

    prefs.set_(PREFS_KEY, asdict(cfg))


def openai_key() -> Optional[str]:
    from services import settings_store

    return settings_store.get_secret(OPENAI_KEY_SECRET)


def set_openai_key(value: Optional[str]) -> None:
    from services import settings_store

    if value:
        settings_store.set_secret(OPENAI_KEY_SECRET, value)
    else:
        settings_store.clear_secret(OPENAI_KEY_SECRET)


def valid_openai_base(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.username or parts.password or parts.query or parts.fragment or not parts.hostname:
        return False
    loopback = parts.hostname in ("127.0.0.1", "localhost", "::1")
    return parts.scheme == "https" or (parts.scheme == "http" and loopback)


def comfyui_ready(cfg: SourceConfig) -> tuple[bool, str]:
    from services.outbound_http import UnsafeEndpoint, resolve_trusted_endpoint

    try:
        resolve_trusted_endpoint(cfg.comfyui_url)
    except UnsafeEndpoint:
        return False, "comfyui_url"
    if "{{prompt}}" not in cfg.comfyui_workflow:
        return False, "comfyui_workflow"
    return True, ""


def _host(url: str) -> str:
    try:
        return urlsplit(url).netloc or url
    except ValueError:
        return url


def describe_one(source: str, cfg: SourceConfig) -> dict:
    """Client-safe state of one source. Probes only local files and DNS."""
    from .cli import locate

    if source in ("codex", "agy"):
        command = locate(source)
        return {
            "id": source,
            "available": command is not None,
            "detail": "" if command else "not_installed",
            "local": False,
            "destination": "OpenAI" if source == "codex" else "Google",
        }
    if source == "comfyui":
        ok, why = comfyui_ready(cfg)
        return {"id": source, "available": ok, "detail": why, "local": True,
                "destination": _host(cfg.comfyui_url)}
    ok = bool(openai_key()) and valid_openai_base(cfg.openai_base_url)
    host = urlsplit(cfg.openai_base_url).hostname or ""
    return {
        "id": source,
        "available": ok,
        "detail": "" if ok else ("no_key" if not openai_key() else "base_url"),
        "local": host in ("127.0.0.1", "localhost", "::1"),
        "destination": _host(cfg.openai_base_url),
    }


def describe_sources() -> dict:
    cfg = load_config()
    return {
        "active": cfg.active,
        "sources": [describe_one(s, cfg) for s in SOURCE_IDS],
        "settings": {
            "comfyui_url": cfg.comfyui_url,
            "comfyui_workflow": cfg.comfyui_workflow,
            "openai_base_url": cfg.openai_base_url,
            "openai_model": cfg.openai_model,
            "openai_key_set": bool(openai_key()),
        },
    }
