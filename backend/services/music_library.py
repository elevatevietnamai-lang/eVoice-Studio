"""Saved Music Studio tracks: one audio file plus a JSON sidecar per track, under the data dir."""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Optional

from core.config import DATA_DIR

_ID_RE = re.compile(r"[0-9a-f]{12}")


def library_dir() -> Path:
    path = Path(DATA_DIR) / "music"
    path.mkdir(parents=True, exist_ok=True)
    return path


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def audio_path(track_id: str, ext: str = "wav") -> Path:
    if not _ID_RE.fullmatch(track_id or ""):
        raise ValueError("Invalid track id")
    return library_dir() / f"{track_id}.{ext}"


def _meta_path(track_id: str) -> Path:
    if not _ID_RE.fullmatch(track_id or ""):
        raise ValueError("Invalid track id")
    return library_dir() / f"{track_id}.json"


def save(track_id: str, **meta) -> dict:
    record = {"id": track_id, "created_at": time.time(), "ext": "wav", **meta}
    tmp = str(_meta_path(track_id)) + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False)
    os.replace(tmp, _meta_path(track_id))
    return record


def get(track_id: str) -> Optional[dict]:
    try:
        record = json.loads(_meta_path(track_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return record if audio_path(track_id, record.get("ext", "wav")).is_file() else None


def list_tracks() -> list[dict]:
    records = []
    for meta in library_dir().glob("*.json"):
        if _ID_RE.fullmatch(meta.stem):
            record = get(meta.stem)
            if record:
                records.append(record)
    return sorted(records, key=lambda r: r.get("created_at", 0), reverse=True)


def delete(track_id: str) -> bool:
    record = get(track_id)
    if not record:
        return False
    for path in (audio_path(track_id, record.get("ext", "wav")), _meta_path(track_id)):
        try:
            path.unlink()
        except OSError:
            pass
    return True
