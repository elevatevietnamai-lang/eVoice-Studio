"""Generated images in the shared media library, with their provenance.

Images land in ``OUTPUTS_DIR/promo_media`` under the same ``<16 hex>.<ext>`` id
the promo builder and video editor use, so they can be placed like any upload.
Provenance lives apart, in ``OUTPUTS_DIR/image_provenance/<media id>.json``.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
import uuid
from typing import Optional

MEDIA_ID = re.compile(r"^[0-9a-f]{16}\.(png|jpg|jpeg|webp)$")
MAX_RESULT_BYTES = 50 * 1024 * 1024
MAX_RESULT_PIXELS = 64_000_000
MIN_SIDE = 64
_FORMATS = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}


def media_dir() -> str:
    from core.config import OUTPUTS_DIR

    path = os.path.join(OUTPUTS_DIR, "promo_media")
    os.makedirs(path, exist_ok=True)
    return path


def provenance_dir() -> str:
    from core.config import OUTPUTS_DIR

    path = os.path.join(OUTPUTS_DIR, "image_provenance")
    os.makedirs(path, exist_ok=True)
    return path


def resolve_image(media_id: str) -> Optional[str]:
    """A library image's path by id, or ``None``."""
    if not MEDIA_ID.match(media_id or ""):
        return None
    root = os.path.realpath(media_dir())
    path = os.path.realpath(os.path.join(root, media_id))
    if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
        return None
    return path


def inspect(path: str) -> tuple[str, int, int]:
    """``(ext, width, height)`` of a usable image, else ``ValueError``."""
    from PIL import Image

    size = os.path.getsize(path)
    if size == 0 or size > MAX_RESULT_BYTES:
        raise ValueError("size")
    try:
        with Image.open(path) as image:
            fmt = (image.format or "").upper()
            width, height = image.size
            if width * height > MAX_RESULT_PIXELS:
                raise ValueError("pixels")
            image.verify()
    except ValueError:
        raise
    except Exception:  # noqa: BLE001 — any decoder error means "not an image"
        raise ValueError("decode") from None
    if fmt not in _FORMATS or min(width, height) < MIN_SIDE:
        raise ValueError("format")
    return _FORMATS[fmt], width, height


def _media(media_id: str, width: int, height: int, name: str) -> dict:
    return {
        "id": media_id,
        "kind": "image",
        "name": name,
        "duration": None,
        "width": width,
        "height": height,
        "has_audio": False,
        "url": f"/audio/promo_media/{media_id}",
    }


def add(path: str, *, prompt: str, source: str, kit_id: Optional[str],
        references: list[str], transparent: bool) -> dict:
    """Copy a produced image into the library; returns media + provenance."""
    ext, width, height = inspect(path)
    media_id = f"{uuid.uuid4().hex[:16]}{ext}"
    shutil.copyfile(path, os.path.join(media_dir(), media_id))
    name = f"ai-{source}-{time.strftime('%Y%m%d-%H%M%S')}{ext}"
    provenance = {
        "media_id": media_id,
        "name": name,
        "prompt": prompt,
        "source": source,
        "created_at": time.time(),
        "ai_generated": True,
        "label": "AI image",
        "kit_id": kit_id,
        "references": references,
        "transparent": transparent,
        "width": width,
        "height": height,
    }
    folder = provenance_dir()
    fd, tmp = tempfile.mkstemp(prefix=".prov.", suffix=".tmp", dir=folder)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(provenance, handle, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(folder, media_id + ".json"))
    return {**_media(media_id, width, height, name), "provenance": provenance}


def list_images(limit: int = 200) -> list[dict]:
    folder = provenance_dir()
    items = []
    for entry in os.scandir(folder):
        if not entry.name.endswith(".json"):
            continue
        media_id = entry.name[:-5]
        if not resolve_image(media_id):
            continue  # the media was deleted; its record is stale
        try:
            with open(entry.path, "r", encoding="utf-8") as handle:
                prov = json.load(handle)
        except (OSError, ValueError):
            continue
        if not isinstance(prov, dict):
            continue
        items.append({**_media(media_id, int(prov.get("width") or 0), int(prov.get("height") or 0),
                               str(prov.get("name") or media_id)), "provenance": prov})
    items.sort(key=lambda item: item["provenance"].get("created_at") or 0, reverse=True)
    return items[:limit]
