"""Channel Kit: one brand's reusable materials, stored on this machine.

A Kit is a folder ``DATA_DIR/channel_kits/<kit id>/`` holding ``kit.json`` and
``assets/<asset id><ext>``. Every section of ``kit.json`` is optional so a
half-filled Kit and a guideline draft validate the same way. Assets are named
by a random id that keeps only an allow-listed extension, so nothing a user or
a bundle supplies ever becomes a path.

``.evkit`` is a ZIP of ``kit.json`` plus ``assets/<asset id><ext>`` for the
assets the Kit references. Imports open through ``core.safe_archive`` (entry
names, counts and sizes checked before anything is read), take only members
the manifest names, check each file's content (Pillow for images, magic bytes
for fonts, audio and video), and give every asset a new id.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

EVKIT_FORMAT = "evkit"
SCHEMA_VERSION = 1

#: Upper bounds that keep a Kit small enough to read whole and to bundle.
MAX_KITS = 200
MAX_ASSETS = 400
MAX_ASSET_BYTES = 256 * 1024 * 1024
MAX_KIT_BYTES = 1024 * 1024 * 1024
MAX_EVKIT_BYTES = 1024 * 1024 * 1024
MAX_KIT_JSON_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 64_000_000

_KIT_ID = re.compile(r"^[0-9a-f]{12}$")
_ASSET_ID = re.compile(r"^[0-9a-f]{16}$")
_ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

ASSET_KINDS: dict[str, frozenset[str]] = {
    "image": frozenset({".png", ".jpg", ".jpeg", ".webp"}),
    "font": frozenset({".ttf", ".otf", ".woff", ".woff2"}),
    "audio": frozenset({".mp3", ".wav", ".ogg", ".m4a", ".flac"}),
    "video": frozenset({".mp4", ".webm", ".mov"}),
    "lottie": frozenset({".json", ".lottie"}),
    "rive": frozenset({".riv"}),
}
MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".flac": "audio/flac", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".json": "application/json", ".lottie": "application/zip", ".riv": "application/octet-stream",
}

_LOCK = threading.RLock()


class KitError(Exception):
    """A refusal the page shows as a localized line (``kits:<code>``)."""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


# ── Schema ───────────────────────────────────────────────────────────────────

def _S(limit: int = 200):  # noqa: N802 — short field factory
    return Field("", max_length=limit)


def _L(limit: int = 50):  # noqa: N802
    return Field(default_factory=list, max_length=limit)


Words = list[str]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _check_words(values: list[str], limit: int = 120) -> list[str]:
    out = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("words must be text")
        value = value.strip()
        if len(value) > limit:
            raise ValueError("word is too long")
        if value:
            out.append(value)
    return out


class Logo(_M):
    id: str = Field(..., pattern=_ITEM_ID.pattern)
    variant: Literal["primary", "light", "dark", "icon", "mono", "wordmark"] = "primary"
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    #: Free space around the logo, as a fraction of the logo's width.
    clear_space: float = Field(0.25, ge=0, le=2)
    min_width: float = Field(0.0, ge=0, le=1)  # fraction of the frame width
    note: str = _S(300)


class Swatch(_M):
    name: str = _S(60)
    hex: str = Field(..., pattern=_HEX.pattern)
    role: Literal["primary", "secondary", "accent", "background", "text", "other"] = "other"
    usage: float = Field(0.0, ge=0, le=1)

    @field_validator("hex")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()


class Font(_M):
    family: str = Field(..., min_length=1, max_length=80)
    role: Literal["heading", "body", "caption", "other"] = "other"
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    weights: list[int] = _L(9)


class Identity(_M):
    logos: list[Logo] = _L(20)
    palette: list[Swatch] = _L(24)
    fonts: list[Font] = _L(12)
    corner_radius: float = Field(0.0, ge=0, le=1)
    image_style: str = _S(600)
    #: White and black always pass the colour check unless this is off.
    allow_neutrals: bool = True


class Motion(_M):
    easing: Words = _L(12)
    speed: Literal["slow", "medium", "fast", ""] = ""
    transitions_allowed: Words = _L(30)
    text_in: str = _S(60)
    text_out: str = _S(60)
    intro_asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    outro_asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    lower_third_asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    note: str = _S(600)

    _w = field_validator("easing", "transitions_allowed")(lambda cls, v: _check_words(v, 60))


class NamedAsset(_M):
    name: str = _S(80)
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)


class Audio(_M):
    brand_voice_id: str = _S(80)
    speech_rate: float = Field(1.0, ge=0.5, le=2.0)
    emotion: str = _S(60)
    music: list[NamedAsset] = _L(30)
    jingle: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    logo_sound: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    sfx: list[NamedAsset] = _L(60)


class PoseRef(_M):
    pose: str = _S(60)
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)


class CharacterAnimation(_M):
    kind: Literal["lottie", "rive", ""] = ""
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)


class Character(_M):
    id: str = Field(..., pattern=_ITEM_ID.pattern)
    name: str = Field(..., min_length=1, max_length=80)
    personality: str = _S(600)
    catchphrases: Words = _L(20)
    voice_id: str = _S(80)
    appearance: str = _S(600)
    references: list[PoseRef] = _L(24)
    animation: CharacterAnimation = Field(default_factory=CharacterAnimation)

    _w = field_validator("catchphrases")(lambda cls, v: _check_words(v, 200))


class VoiceTone(_M):
    tone: str = _S(300)
    address: str = _S(120)
    preferred_words: Words = _L(80)
    banned_words: Words = _L(80)
    ctas: Words = _L(20)
    hashtags: Words = _L(40)
    sign_off: str = _S(200)

    _w = field_validator("preferred_words", "banned_words", "ctas", "hashtags")(
        lambda cls, v: _check_words(v, 200)
    )


class Persona(_M):
    name: str = _S(80)
    description: str = _S(600)
    pains: Words = _L(20)
    benefits: Words = _L(20)

    _w = field_validator("pains", "benefits")(lambda cls, v: _check_words(v, 200))


class Product(_M):
    id: str = Field(..., pattern=_ITEM_ID.pattern)
    name: str = Field(..., min_length=1, max_length=120)
    price: str = _S(40)
    usps: Words = _L(20)
    proofs: Words = _L(20)
    images: list[str] = _L(20)

    _w = field_validator("usps", "proofs")(lambda cls, v: _check_words(v, 300))

    @field_validator("images")
    @classmethod
    def _assets(cls, values: list[str]) -> list[str]:
        for value in values:
            if not _ASSET_ID.match(value or ""):
                raise ValueError("bad asset id")
        return values


class Beat(_M):
    name: str = _S(60)
    seconds: float = Field(0.0, ge=0, le=3600)


class SafeZone(_M):
    """Fractions of the frame covered by the platform's own UI."""

    top: float = Field(0.0, ge=0, le=0.5)
    bottom: float = Field(0.0, ge=0, le=0.5)
    left: float = Field(0.0, ge=0, le=0.5)
    right: float = Field(0.0, ge=0, le=0.5)


Platform = Literal["tiktok", "reels", "shorts", "youtube", "facebook", "other"]


class ChannelFormat(_M):
    id: str = Field(..., pattern=_ITEM_ID.pattern)
    name: str = _S(80)
    series: str = _S(80)
    platform: Platform = "other"
    aspect: Literal["9:16", "1:1", "16:9", "4:5", "4:3"] = "9:16"
    duration_min: float = Field(0.0, ge=0, le=7200)
    duration_max: float = Field(0.0, ge=0, le=7200)
    structure: list[Beat] = _L(20)
    safe_zone: Optional[SafeZone] = None


class Captions(_M):
    font: str = _S(80)
    color: str = Field("", pattern=r"^(#[0-9a-fA-F]{6})?$")
    highlight_color: str = Field("", pattern=r"^(#[0-9a-fA-F]{6})?$")
    position: Literal["bottom", "middle", "top", ""] = ""
    karaoke: bool = False
    bilingual: bool = False


class Legal(_M):
    disclaimer: str = _S(600)
    watermark_asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    ai_label: bool = False
    ai_label_text: str = _S(120)


class ReferenceVideo(_M):
    name: str = _S(120)
    asset: Optional[str] = Field(None, pattern=_ASSET_ID.pattern)
    notes: str = _S(600)


class Episode(_M):
    date: str = _S(32)
    title: str = _S(200)
    topic: str = _S(300)
    hook: str = _S(300)
    cta: str = _S(200)


class AssetInfo(_M):
    kind: Literal["image", "font", "audio", "video", "lottie", "rive"]
    name: str = _S(200)
    ext: str = Field(..., pattern=r"^\.[a-z0-9]{2,6}$")
    size: int = Field(0, ge=0)


class KitBody(_M):
    """What a client may write. Ids, timestamps and assets are the server's."""

    name: str = Field(..., min_length=1, max_length=80)
    description: str = _S(600)
    identity: Identity = Field(default_factory=Identity)
    motion: Motion = Field(default_factory=Motion)
    audio: Audio = Field(default_factory=Audio)
    characters: list[Character] = _L(20)
    voice_tone: VoiceTone = Field(default_factory=VoiceTone)
    audience: list[Persona] = _L(12)
    products: list[Product] = _L(50)
    formats: list[ChannelFormat] = _L(20)
    captions: Captions = Field(default_factory=Captions)
    legal: Legal = Field(default_factory=Legal)
    references: list[ReferenceVideo] = _L(12)
    memory: list[Episode] = _L(500)


class Kit(KitBody):
    format: Literal["evkit"] = EVKIT_FORMAT
    schema_version: int = SCHEMA_VERSION
    id: str = Field(..., pattern=_KIT_ID.pattern)
    created_at: float = 0.0
    updated_at: float = 0.0
    assets: dict[str, AssetInfo] = Field(default_factory=dict, max_length=MAX_ASSETS)

    @field_validator("assets")
    @classmethod
    def _asset_ids(cls, value: dict[str, AssetInfo]) -> dict[str, AssetInfo]:
        for key, info in value.items():
            if not _ASSET_ID.match(key):
                raise ValueError("bad asset id")
            if info.ext not in ASSET_KINDS[info.kind]:
                raise ValueError("asset extension does not match its kind")
        return value


def referenced_assets(kit: KitBody) -> set[str]:
    """Every asset id the Kit's sections point at."""
    found: set[str] = set()

    def walk(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)
        elif isinstance(value, str) and (key == "asset" or key.endswith("_asset")
                                         or key in ("jingle", "logo_sound", "images")):
            if _ASSET_ID.match(value):
                found.add(value)

    walk(kit.model_dump(exclude={"assets"} if isinstance(kit, Kit) else None))
    return found


# ── Storage ──────────────────────────────────────────────────────────────────

def kits_root() -> str:
    from core.config import DATA_DIR

    path = os.path.join(DATA_DIR, "channel_kits")
    os.makedirs(path, exist_ok=True)
    return path


def _kit_dir(kit_id: str) -> str:
    if not _KIT_ID.match(kit_id or ""):
        raise KitError("not_found", 404)
    return os.path.join(kits_root(), kit_id)


def _write_json(path: str, data: dict) -> None:
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".kit.", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _parse(raw: bytes) -> Kit:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise KitError("bad_kit", 422) from None
    if not isinstance(data, dict) or data.get("format") != EVKIT_FORMAT:
        raise KitError("bad_kit", 422)
    if not isinstance(data.get("schema_version"), int) or data["schema_version"] > SCHEMA_VERSION:
        raise KitError("newer_kit", 422)
    try:
        return Kit.model_validate(data)
    except ValidationError:
        raise KitError("bad_kit", 422) from None


def load(kit_id: str) -> Kit:
    path = os.path.join(_kit_dir(kit_id), "kit.json")
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_KIT_JSON_BYTES + 1)
    except FileNotFoundError:
        raise KitError("not_found", 404) from None
    if len(raw) > MAX_KIT_JSON_BYTES:
        raise KitError("bad_kit", 422)
    kit = _parse(raw)
    if kit.id != kit_id:
        raise KitError("bad_kit", 422)
    return kit


def _save(kit: Kit) -> Kit:
    data = kit.model_dump(mode="json")
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > MAX_KIT_JSON_BYTES:
        raise KitError("too_large", 413)
    _write_json(os.path.join(_kit_dir(kit.id), "kit.json"), data)
    return kit


def list_kits() -> list[Kit]:
    kits = []
    for name in sorted(os.listdir(kits_root())):
        if not _KIT_ID.match(name):
            continue
        try:
            kits.append(load(name))
        except KitError:
            continue  # a damaged folder never hides the others
    kits.sort(key=lambda k: k.updated_at, reverse=True)
    return kits


def _check_refs(body: KitBody, assets: dict[str, AssetInfo]) -> None:
    missing = referenced_assets(body) - set(assets)
    if missing:
        raise KitError("missing_asset", 422)


def create(body: KitBody) -> Kit:
    with _LOCK:
        if sum(1 for n in os.listdir(kits_root()) if _KIT_ID.match(n)) >= MAX_KITS:
            raise KitError("too_many", 409)
        if referenced_assets(body):
            raise KitError("missing_asset", 422)
        now = time.time()
        kit = Kit(**body.model_dump(), id=uuid.uuid4().hex[:12], created_at=now, updated_at=now)
        return _save(kit)


def update(kit_id: str, body: KitBody) -> Kit:
    with _LOCK:
        current = load(kit_id)
        _check_refs(body, current.assets)
        kit = Kit(**body.model_dump(), id=kit_id, created_at=current.created_at,
                  updated_at=time.time(), assets=current.assets)
        return _save(kit)


def delete(kit_id: str) -> None:
    with _LOCK:
        folder = _kit_dir(kit_id)
        if not os.path.isdir(folder):
            raise KitError("not_found", 404)
        shutil.rmtree(folder)


def add_memory(kit_id: str, episode: Episode) -> Kit:
    with _LOCK:
        kit = load(kit_id)
        memory = [*kit.memory, episode][-500:]
        return _save(kit.model_copy(update={"memory": memory, "updated_at": time.time()}))


# ── Assets ───────────────────────────────────────────────────────────────────

def kind_for(ext: str) -> Optional[str]:
    for kind, exts in ASSET_KINDS.items():
        if ext in exts:
            return kind
    return None


_MAGIC = {
    "font": (b"\x00\x01\x00\x00", b"OTTO", b"true", b"wOFF", b"wOF2", b"ttcf"),
    "rive": (b"RIVE",),
}


def check_content(path: str, kind: str, ext: str) -> None:
    """Refuse a file whose bytes do not match its extension."""
    with open(path, "rb") as handle:
        head = handle.read(16)
    if not head:
        raise KitError("bad_asset", 422)
    if kind == "image":
        from PIL import Image

        try:
            with Image.open(path) as image:
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise KitError("bad_asset", 422)
                fmt = (image.format or "").upper()
                image.verify()
        except KitError:
            raise
        except Exception:  # noqa: BLE001 — any decoder error means "not an image"
            raise KitError("bad_asset", 422) from None
        expected = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}[ext]
        if fmt != expected:
            raise KitError("bad_asset", 422)
    elif kind in _MAGIC:
        if not head.startswith(_MAGIC[kind]):
            raise KitError("bad_asset", 422)
    elif kind == "lottie":
        if ext == ".lottie":
            if not head.startswith(b"PK"):
                raise KitError("bad_asset", 422)
        else:
            try:
                with open(path, "rb") as handle:
                    data = json.loads(handle.read(32 * 1024 * 1024).decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise KitError("bad_asset", 422) from None
            if not isinstance(data, dict) or "layers" not in data:
                raise KitError("bad_asset", 422)
    elif kind == "audio":
        ok = (head.startswith((b"ID3", b"RIFF", b"OggS", b"fLaC")) or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xf1", b"\xff\xf9")
              or head[4:8] == b"ftyp")
        if not ok:
            raise KitError("bad_asset", 422)
    elif kind == "video":
        if not (head[4:8] == b"ftyp" or head.startswith(b"\x1a\x45\xdf\xa3")):
            raise KitError("bad_asset", 422)


def _kit_bytes(kit_id: str) -> int:
    folder = os.path.join(_kit_dir(kit_id), "assets")
    if not os.path.isdir(folder):
        return 0
    return sum(entry.stat().st_size for entry in os.scandir(folder) if entry.is_file())


def add_asset(kit_id: str, source_path: str, filename: str) -> tuple[str, AssetInfo]:
    """Move an uploaded temp file into the Kit. The caller's file is consumed."""
    ext = os.path.splitext(filename or "")[1].lower()
    kind = kind_for(ext)
    try:
        if kind is None:
            raise KitError("asset_type", 415)
        size = os.path.getsize(source_path)
        if size == 0 or size > MAX_ASSET_BYTES:
            raise KitError("asset_size", 413)
        check_content(source_path, kind, ext)
        with _LOCK:
            kit = load(kit_id)
            if len(kit.assets) >= MAX_ASSETS:
                raise KitError("too_many_assets", 409)
            if _kit_bytes(kit_id) + size > MAX_KIT_BYTES:
                raise KitError("kit_size", 413)
            asset_id = uuid.uuid4().hex[:16]
            folder = os.path.join(_kit_dir(kit_id), "assets")
            os.makedirs(folder, exist_ok=True)
            shutil.move(source_path, os.path.join(folder, asset_id + ext))
            info = AssetInfo(kind=kind, name=os.path.basename(filename)[:200], ext=ext, size=size)
            _save(kit.model_copy(update={"assets": {**kit.assets, asset_id: info},
                                         "updated_at": time.time()}))
            return asset_id, info
    finally:
        if os.path.exists(source_path):
            try:
                os.remove(source_path)
            except OSError:
                pass


def asset_path(kit_id: str, asset_id: str) -> tuple[str, AssetInfo]:
    if not _ASSET_ID.match(asset_id or ""):
        raise KitError("not_found", 404)
    kit = load(kit_id)
    info = kit.assets.get(asset_id)
    if info is None:
        raise KitError("not_found", 404)
    root = os.path.realpath(os.path.join(_kit_dir(kit_id), "assets"))
    path = os.path.realpath(os.path.join(root, asset_id + info.ext))
    if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
        raise KitError("not_found", 404)
    return path, info


def remove_asset(kit_id: str, asset_id: str) -> Kit:
    with _LOCK:
        path, _ = asset_path(kit_id, asset_id)
        kit = load(kit_id)
        if asset_id in referenced_assets(kit):
            raise KitError("asset_in_use", 409)
        assets = {k: v for k, v in kit.assets.items() if k != asset_id}
        kit = _save(kit.model_copy(update={"assets": assets, "updated_at": time.time()}))
        try:
            os.remove(path)
        except OSError:
            pass
        return kit


# ── .evkit bundles ───────────────────────────────────────────────────────────

def export_bundle(kit_id: str, dest: str) -> str:
    """Write ``<dest>`` as an .evkit with only the referenced assets."""
    kit = load(kit_id)
    used = referenced_assets(kit)
    assets = {k: v for k, v in kit.assets.items() if k in used}
    data = kit.model_copy(update={"assets": assets}).model_dump(mode="json")
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("kit.json", json.dumps(data, ensure_ascii=False, indent=1))
        for asset_id, info in assets.items():
            path, _ = asset_path(kit_id, asset_id)
            # Media is already compressed; storing it keeps the export fast.
            zf.write(path, f"assets/{asset_id}{info.ext}", compress_type=zipfile.ZIP_STORED)
    return dest


def import_bundle(bundle_path: str) -> Kit:
    """Add the Kit in an .evkit as a new Kit (new ids for the Kit and assets)."""
    from core.safe_archive import ArchiveError, copy_member, open_bounded_zip, read_member

    size = os.path.getsize(bundle_path)
    if size == 0 or size > MAX_EVKIT_BYTES:
        raise KitError("bundle_size", 413)
    with open(bundle_path, "rb") as handle:
        data = handle.read()
    try:
        zf = open_bounded_zip(data, max_members=MAX_ASSETS + 8, max_member_bytes=MAX_ASSET_BYTES,
                              max_total_bytes=MAX_KIT_BYTES + MAX_KIT_JSON_BYTES)
    except ArchiveError as exc:
        raise KitError("bad_bundle", exc.status) from None
    with zf:
        names = set(zf.namelist())
        if "kit.json" not in names:
            raise KitError("bad_bundle", 422)
        try:
            kit = _parse(read_member(zf, "kit.json", MAX_KIT_JSON_BYTES))
        except ArchiveError as exc:
            raise KitError("bad_bundle", exc.status) from None
        if referenced_assets(kit) - set(kit.assets):
            raise KitError("missing_asset", 422)
        with _LOCK:
            if sum(1 for n in os.listdir(kits_root()) if _KIT_ID.match(n)) >= MAX_KITS:
                raise KitError("too_many", 409)
            new_id = uuid.uuid4().hex[:12]
            staging = tempfile.mkdtemp(prefix=".import-", dir=kits_root())
            try:
                assets_dir = os.path.join(staging, "assets")
                os.makedirs(assets_dir)
                remap: dict[str, str] = {}
                new_assets: dict[str, AssetInfo] = {}
                for old_id, info in kit.assets.items():
                    member = f"assets/{old_id}{info.ext}"
                    if member not in names:
                        continue  # unreferenced entries may be left out
                    fresh = uuid.uuid4().hex[:16]
                    dest = os.path.join(assets_dir, fresh + info.ext)
                    try:
                        copy_member(zf, member, dest, MAX_ASSET_BYTES)
                    except ArchiveError as exc:
                        raise KitError("bad_bundle", exc.status) from None
                    check_content(dest, info.kind, info.ext)
                    remap[old_id] = fresh
                    new_assets[fresh] = info.model_copy(update={"size": os.path.getsize(dest)})
                body = _remap(kit, remap)
                if referenced_assets(body) - set(new_assets):
                    raise KitError("missing_asset", 422)
                now = time.time()
                fresh_kit = Kit(**body.model_dump(exclude={"id", "created_at", "updated_at", "assets",
                                                           "format", "schema_version"}),
                                id=new_id, created_at=now, updated_at=now, assets=new_assets)
                _write_json(os.path.join(staging, "kit.json"), fresh_kit.model_dump(mode="json"))
                os.replace(staging, os.path.join(kits_root(), new_id))
                return fresh_kit
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise


def _remap(kit: Kit, remap: dict[str, str]) -> Kit:
    def walk(value: Any, key: str = "") -> Any:
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [walk(v, key) for v in value]
        if isinstance(value, str) and value in remap and (
            key == "asset" or key.endswith("_asset") or key in ("jingle", "logo_sound", "images")
        ):
            return remap[value]
        return value

    data = walk(kit.model_dump(exclude={"assets"}))
    return Kit.model_validate({**data, "assets": {}})


def summary(kit: Kit) -> dict:
    logo = next((l for l in kit.identity.logos if l.asset and l.variant == "primary"), None) or next(
        (l for l in kit.identity.logos if l.asset), None
    )
    return {
        "id": kit.id,
        "name": kit.name,
        "description": kit.description,
        "updated_at": kit.updated_at,
        "logo_url": f"/kits/{kit.id}/assets/{logo.asset}" if logo else None,
    }


def to_client(kit: Kit) -> dict:
    data = kit.model_dump(mode="json")
    for asset_id, info in data["assets"].items():
        info["mime"] = MIME.get(info["ext"], "application/octet-stream")
        info["url"] = f"/kits/{kit.id}/assets/{asset_id}"
    return data


__all__ = [
    "Kit", "KitBody", "KitError", "Episode", "add_asset", "add_memory", "asset_path", "create",
    "delete", "export_bundle", "import_bundle", "list_kits", "load", "referenced_assets",
    "remove_asset", "summary", "to_client", "update",
]

_ = io  # keep the import for callers that stream bundles
