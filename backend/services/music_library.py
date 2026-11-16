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
ALLOWED_EXTS = frozenset({"wav", "mp3", "flac", "ogg"})
MAX_TRACKS = 200


def library_dir() -> Path:
    path = Path(DATA_DIR) / "music"
    path.mkdir(parents=True, exist_ok=True)
    return path


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def audio_path(track_id: str, ext: str = "wav") -> Path:
    if not _ID_RE.fullmatch(track_id or ""):
        raise ValueError("Invalid track id")
    if ext not in ALLOWED_EXTS:
        raise ValueError("Unsupported audio type")
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


def _clean_record(record: dict) -> dict:
    """Tracks saved by 0.5.7-beta.3 may hold the server's "N/A" as their key or meter."""
    from services.music import clean_key, clean_meter

    for name, clean in (("key_scale", clean_key), ("time_signature", clean_meter)):
        if name in record:
            record[name] = clean(record[name])
    return record


def get(track_id: str) -> Optional[dict]:
    try:
        record = json.loads(_meta_path(track_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(record, dict):
        return None
    try:
        return _clean_record(record) if audio_path(track_id, record.get("ext", "wav")).is_file() else None
    except ValueError:
        return None


def list_tracks() -> list[dict]:
    records = []
    for meta in library_dir().glob("*.json"):
        if _ID_RE.fullmatch(meta.stem):
            record = get(meta.stem)
            if record:
                records.append(record)
    return sorted(records, key=lambda r: r.get("created_at", 0), reverse=True)


def resolve_track_audio(track_id: str) -> Path:
    """The audio file of a saved track, for use as a cover/repaint source or a style reference."""
    record = get(track_id)
    if not record:
        raise ValueError("That track is no longer in the library.")
    return audio_path(track_id, record.get("ext", "wav"))


# ── Uploaded source audio (cover, repaint, style reference)
# The client only ever names an upload by its id; the path is resolved here, under the library.

UPLOAD_EXTS = frozenset({"wav", "mp3", "flac", "ogg", "m4a"})
# What the music engine's soundfile (libsndfile 1.2) reads; anything else is stored as FLAC.
ENGINE_EXTS = frozenset({"wav", "mp3", "flac", "ogg"})
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_UPLOADS = 20


def uploads_dir() -> Path:
    path = library_dir() / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def upload_ext(filename: str) -> str:
    ext = Path(filename or "").suffix.lower().lstrip(".")
    if ext not in UPLOAD_EXTS:
        raise ValueError("Use a WAV, MP3, FLAC, OGG or M4A file.")
    return ext


def upload_path(upload_id: str, ext: str) -> Path:
    if not _ID_RE.fullmatch(upload_id or ""):
        raise ValueError("Invalid upload id")
    if ext not in UPLOAD_EXTS:
        raise ValueError("Unsupported audio type")
    return uploads_dir() / f"{upload_id}.{ext}"


def resolve_upload(upload_id: str) -> Path:
    """The stored file for *upload_id* (whatever its extension), or ValueError."""
    if not _ID_RE.fullmatch(upload_id or ""):
        raise ValueError("Invalid upload id")
    for ext in sorted(UPLOAD_EXTS):
        path = uploads_dir() / f"{upload_id}.{ext}"
        if path.is_file():
            return path
    raise ValueError("That uploaded file is gone. Upload it again.")


async def engine_readable(path: Path) -> Path:
    """*path* when the engine can read it, else a FLAC copy beside it (the original is removed)."""
    from services.ffmpeg_utils import find_ffmpeg, run_ffmpeg

    ext = path.suffix.lower().lstrip(".")
    if ext in ENGINE_EXTS:
        return path
    if path.parent.resolve() != uploads_dir().resolve():
        raise ValueError("Unsupported audio type")
    target = path.with_suffix(".flac")
    tmp = target.with_name(target.stem + ".part.flac")
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise ValueError("ffmpeg is needed to read this file. Use a WAV, MP3, FLAC or OGG file.")
    code, _out, err = await run_ffmpeg([ffmpeg, "-v", "error", "-y", "-i", str(path), "-vn",
                                        "-c:a", "flac", str(tmp)], timeout=600)
    if code != 0 or not tmp.is_file():
        tmp.unlink(missing_ok=True)
        raise ValueError("That file has no audio this app can read.")
    os.replace(tmp, target)
    path.unlink(missing_ok=True)
    return target


def prune_uploads(keep: int = MAX_UPLOADS) -> None:
    """Keep only the newest *keep* uploads; older source files are not part of the library."""
    files = sorted((p for p in uploads_dir().iterdir() if p.is_file()),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[keep:]:
        try:
            stale.unlink()
        except OSError:
            pass


# ── The music LoRA: one adapter the user picked in the desktop app (its path came from the
# native file picker as a one-shot grant). Kept beside the library so it survives restarts.

def _lora_file() -> Path:
    return library_dir() / "lora.json"


def get_lora() -> Optional[dict]:
    try:
        data = json.loads(_lora_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("path"), str) or not data["path"]:
        return None
    return data


def save_lora(data: Optional[dict]) -> None:
    if data is None:
        _lora_file().unlink(missing_ok=True)
        return
    tmp = _lora_file().with_suffix(".part")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _lora_file())


def free_slots() -> int:
    return max(0, MAX_TRACKS - len(list_tracks()))


def is_full() -> bool:
    return free_slots() == 0


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
