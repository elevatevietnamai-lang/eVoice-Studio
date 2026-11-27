"""Channel Kits: a brand's colours, fonts, logos, voices, characters and rules.

Stored on this machine (``services.channel_kit``); ``.evkit`` bundles move a Kit
between machines. ``POST /kits/{id}/check`` is the local brand compliance
check (``services.brand_check``). ``/kits/guideline`` drafts a Kit from a
guideline file with the LLM provider the user confirmed. Errors carry
``detail = "kits:<code>"`` for a localized message.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import shutil
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from services import brand_check
from services import channel_kit as ck

logger = logging.getLogger("omnivoice.kits")
router = APIRouter(tags=["kits"])

_LANGUAGE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


def _fail(exc: ck.KitError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=f"kits:{exc.code}")


async def _spool(file: UploadFile, limit: int) -> str:
    """Stream an upload to a temp file, refusing it past ``limit`` bytes."""
    fd, path = tempfile.mkstemp(prefix="evkit-upload-", dir=ck.kits_root())

    def copy() -> int:
        seen = 0
        with os.fdopen(fd, "wb") as out:
            file.file.seek(0)
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    return seen
                seen += len(chunk)
                if seen > limit:
                    raise ck.KitError("asset_size", 413)
                out.write(chunk)

    try:
        await asyncio.to_thread(copy)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(path)
        raise
    finally:
        await file.close()
    return path


@router.get("/kits")
async def kits_list() -> dict:
    """Every Kit on this machine, newest first: ``{kits: [{id, name, description, updated_at, logo_url}]}``."""
    kits = await asyncio.to_thread(ck.list_kits)
    return {"kits": [ck.summary(k) for k in kits]}


@router.post("/kits")
async def kits_create(body: ck.KitBody) -> dict:
    """Create a Kit. Asset fields must be empty: upload assets to the new Kit afterwards."""
    try:
        return ck.to_client(await asyncio.to_thread(ck.create, body))
    except ck.KitError as exc:
        raise _fail(exc)


@router.post("/kits/import")
async def kits_import(file: UploadFile = File(...)) -> dict:
    """Add the Kit in an ``.evkit`` bundle as a new Kit (new ids)."""
    try:
        path = await _spool(file, ck.MAX_EVKIT_BYTES)
        try:
            kit = await asyncio.to_thread(ck.import_bundle, path)
        finally:
            with contextlib.suppress(OSError):
                os.remove(path)
    except ck.KitError as exc:
        raise _fail(exc)
    return ck.to_client(kit)


# ── Guideline → draft (declared before /kits/{kit_id}) ───────────────────────

@router.get("/kits/guideline")
async def kits_guideline_provider() -> dict:
    """Which LLM provider a text guideline would be sent to. Nothing is sent."""
    from services import promo_scene_writer

    return await asyncio.to_thread(promo_scene_writer.describe)


@router.post("/kits/guideline")
async def kits_guideline(
    file: UploadFile = File(...),
    provider_id: str = Form("", max_length=64),
    language: str = Form("en", max_length=16),
) -> dict:
    """Draft Kit sections from a guideline (PDF, Markdown, text or image).

    Text is sent to ``provider_id`` (refused if it is not the active provider);
    an image is measured locally and sent nowhere. Returns ``{draft, sent_to}``;
    nothing is saved.
    """
    from services import kit_guideline
    from services.promo_scene_writer import WriterError

    if not _LANGUAGE_RE.match(language):
        raise HTTPException(status_code=422, detail="kits:language")
    data = await file.read(kit_guideline.MAX_FILE_BYTES + 1)
    name = file.filename or ""
    await file.close()
    try:
        return await asyncio.to_thread(
            kit_guideline.draft_from_file, data, name, provider_id=provider_id or None, language=language,
        )
    except WriterError as exc:
        logger.info("kit guideline refused: %s", exc.code)
        raise HTTPException(status_code=exc.status, detail=f"kits:{exc.code}")


@router.get("/kits/{kit_id}")
async def kits_get(kit_id: str) -> dict:
    """The whole Kit, with ``assets[id].url`` to fetch each file."""
    try:
        return ck.to_client(await asyncio.to_thread(ck.load, kit_id))
    except ck.KitError as exc:
        raise _fail(exc)


@router.put("/kits/{kit_id}")
async def kits_update(kit_id: str, body: ck.KitBody) -> dict:
    """Replace the Kit's sections. Asset ids must belong to this Kit."""
    try:
        return ck.to_client(await asyncio.to_thread(ck.update, kit_id, body))
    except ck.KitError as exc:
        raise _fail(exc)


@router.delete("/kits/{kit_id}")
async def kits_delete(kit_id: str) -> dict:
    try:
        await asyncio.to_thread(ck.delete, kit_id)
    except ck.KitError as exc:
        raise _fail(exc)
    return {"deleted": kit_id}


@router.post("/kits/{kit_id}/memory")
async def kits_memory(kit_id: str, episode: ck.Episode) -> dict:
    """Add one finished episode to the channel memory (topic, hook, CTA)."""
    try:
        return ck.to_client(await asyncio.to_thread(ck.add_memory, kit_id, episode))
    except ck.KitError as exc:
        raise _fail(exc)


@router.post("/kits/{kit_id}/assets")
async def kits_asset_add(kit_id: str, file: UploadFile = File(...)) -> dict:
    """Store one logo, font, sound, video, Lottie or Rive file in the Kit.

    Returns ``{id, kind, name, ext, size, mime, url}``; put ``id`` into the
    Kit's sections with ``PUT /kits/{id}``.
    """
    try:
        ck.load(kit_id)
        path = await _spool(file, ck.MAX_ASSET_BYTES)
        asset_id, info = await asyncio.to_thread(ck.add_asset, kit_id, path, file.filename or "")
    except ck.KitError as exc:
        raise _fail(exc)
    return {"id": asset_id, **info.model_dump(), "mime": ck.MIME.get(info.ext),
            "url": f"/kits/{kit_id}/assets/{asset_id}"}


@router.get("/kits/{kit_id}/assets/{asset_id}")
async def kits_asset_get(kit_id: str, asset_id: str) -> FileResponse:
    try:
        path, info = await asyncio.to_thread(ck.asset_path, kit_id, asset_id)
    except ck.KitError as exc:
        raise _fail(exc)
    return FileResponse(
        path,
        media_type=ck.MIME.get(info.ext, "application/octet-stream"),
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )


@router.delete("/kits/{kit_id}/assets/{asset_id}")
async def kits_asset_delete(kit_id: str, asset_id: str) -> dict:
    """Remove an asset no section uses any more (409 ``kits:asset_in_use`` otherwise)."""
    try:
        return ck.to_client(await asyncio.to_thread(ck.remove_asset, kit_id, asset_id))
    except ck.KitError as exc:
        raise _fail(exc)


@router.get("/kits/{kit_id}/export")
async def kits_export(kit_id: str) -> FileResponse:
    """The Kit as an ``.evkit`` file (only the assets it uses)."""
    folder = tempfile.mkdtemp(prefix="evkit-export-")
    try:
        kit = await asyncio.to_thread(ck.load, kit_id)
        path = await asyncio.to_thread(ck.export_bundle, kit_id, os.path.join(folder, "kit.evkit"))
    except ck.KitError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise _fail(exc)
    from core.path_security import portable_filename

    name = portable_filename(kit.name, default="channel-kit") + ".evkit"
    return FileResponse(path, media_type="application/zip", filename=name,
                        background=BackgroundTask(shutil.rmtree, folder, True))


@router.post("/kits/{kit_id}/check")
async def kits_check(kit_id: str, project: brand_check.ProjectDescriptor) -> dict:
    """Check a project against the Kit, locally (no LLM).

    Returns ``{ok, issues: [{clip_id, code, severity, detail}]}``; ``ok`` is
    false when any issue is an ``error``.
    """
    try:
        kit = await asyncio.to_thread(ck.load, kit_id)
    except ck.KitError as exc:
        raise _fail(exc)
    issues = brand_check.check(kit, project)
    return {"ok": not any(i["severity"] == "error" for i in issues), "issues": issues}
