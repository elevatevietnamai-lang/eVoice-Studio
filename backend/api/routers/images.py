"""Image sources (Settings → Image sources) and background image jobs.

Off by default. ``POST /images/preview`` builds the exact prompt, reference
list and destination a generation would use; the page shows it, then
``POST /images/generate`` sends that prompt unchanged to the source the page
showed (refused when the selected source changed). Results join the media
library under ``/audio/promo_media/<id>`` with a provenance record. Errors
carry ``detail = "images:<code>"``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from services import image_sources
from services.image_sources import config as cfgmod
from services.image_sources import jobs, library, prompting

logger = logging.getLogger("omnivoice.images")
router = APIRouter(tags=["images"])

Size = Literal["square", "portrait", "landscape"]


def _err(code: str, status: int) -> HTTPException:
    return HTTPException(status_code=status, detail=f"images:{code}")


@router.get("/images/sources")
async def images_sources() -> dict:
    """The selected source (``off`` by default), each source's state and settings.

    Reads local files only (which CLIs are installed); nothing is contacted.
    The OpenAI-style key is never returned, only ``openai_key_set``.
    """
    return await asyncio.to_thread(image_sources.describe_sources)


class SourcesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: Literal["off", "codex", "agy", "comfyui", "openai"]
    comfyui_url: Optional[str] = Field(None, max_length=200)
    comfyui_workflow: Optional[str] = Field(None, max_length=cfgmod.MAX_WORKFLOW_BYTES)
    openai_base_url: Optional[str] = Field(None, max_length=300)
    openai_model: Optional[str] = Field(None, max_length=80, pattern=r"^[A-Za-z0-9._:/-]*$")
    #: A new key; empty string clears it, ``None`` keeps the stored one.
    openai_key: Optional[str] = Field(None, max_length=400)


@router.put("/images/sources")
async def images_sources_update(body: SourcesUpdate) -> dict:
    import json

    cfg = cfgmod.load_config()
    cfg.active = body.active
    if body.comfyui_url is not None:
        cfg.comfyui_url = body.comfyui_url.strip().rstrip("/") or cfgmod.DEFAULT_COMFYUI_URL
    if body.comfyui_workflow is not None:
        text = body.comfyui_workflow.strip()
        if text:
            try:
                parsed = json.loads(text)
            except ValueError:
                raise _err("comfyui_workflow", 422) from None
            if not isinstance(parsed, dict) or "{{prompt}}" not in text:
                raise _err("comfyui_workflow", 422)
        cfg.comfyui_workflow = text
    if body.openai_base_url is not None:
        url = body.openai_base_url.strip().rstrip("/") or cfgmod.DEFAULT_OPENAI_BASE
        if not cfgmod.valid_openai_base(url):
            raise _err("base_url", 422)
        cfg.openai_base_url = url
    if body.openai_model is not None:
        cfg.openai_model = body.openai_model.strip() or cfgmod.DEFAULT_OPENAI_MODEL
    if body.openai_key is not None:
        await asyncio.to_thread(cfgmod.set_openai_key, body.openai_key.strip() or None)
    await asyncio.to_thread(cfgmod.save_config, cfg)
    if cfg.active == "off":
        jobs.cancel_all()
    return await asyncio.to_thread(image_sources.describe_sources)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(..., min_length=1, max_length=prompting.MAX_USER_PROMPT)
    kit_id: Optional[str] = Field(None, max_length=12)
    character_id: Optional[str] = Field(None, max_length=40)
    #: Library images (``/promo/media`` ids) to send as references.
    reference_media_ids: list[str] = Field(default_factory=list, max_length=prompting.MAX_REFERENCES)
    #: Add the Kit character's reference images (needs ``character_id``).
    use_character_references: bool = True
    transparent: bool = False
    size: Size = "square"


def _references(req: "PreviewRequest | GenerateRequest", kit) -> list[prompting.Reference]:
    refs: list[prompting.Reference] = []
    for media_id in req.reference_media_ids:
        path = library.resolve_image(media_id)
        if not path:
            raise _err("reference_not_found", 404)
        refs.append(prompting.Reference(f"media:{media_id}", media_id, path, f"/audio/promo_media/{media_id}"))
    if kit is not None and req.character_id and req.use_character_references:
        from services import channel_kit as ck

        character = next((c for c in kit.characters if c.id == req.character_id), None)
        if character is None:
            raise _err("character_not_found", 404)
        for pose in character.references:
            if not pose.asset:
                continue
            try:
                path, info = ck.asset_path(kit.id, pose.asset)
            except ck.KitError:
                continue
            if info.kind != "image":
                continue
            refs.append(prompting.Reference(f"kit:{kit.id}:{pose.asset}", pose.pose or info.name, path,
                                            f"/kits/{kit.id}/assets/{pose.asset}"))
    if len(refs) > prompting.MAX_REFERENCES:
        refs = refs[: prompting.MAX_REFERENCES]
    return refs


def _kit(kit_id: Optional[str]):
    if not kit_id:
        return None
    from services import channel_kit as ck

    try:
        return ck.load(kit_id)
    except ck.KitError:
        raise _err("kit_not_found", 404) from None


def _active_ready() -> tuple[cfgmod.SourceConfig, dict]:
    cfg = cfgmod.load_config()
    if cfg.active == "off":
        raise _err("off", 409)
    state = cfgmod.describe_one(cfg.active, cfg)
    if not state["available"]:
        raise _err(state["detail"] or "unavailable", 409)
    return cfg, state


@router.post("/images/preview")
async def images_preview(req: PreviewRequest) -> dict:
    """What a generation would send, and where. Nothing is sent by this call.

    Show ``prompt``, ``references`` and ``destination`` to the user, then call
    ``/images/generate`` with this ``prompt`` and ``source_id`` unchanged.
    """
    cfg, state = await asyncio.to_thread(_active_ready)
    kit = await asyncio.to_thread(_kit, req.kit_id)
    refs = await asyncio.to_thread(_references, req, kit)
    prompt = prompting.compose(req.prompt, source=cfg.active, kit=kit, character_id=req.character_id,
                               transparent=req.transparent, size=req.size, references=refs)
    return {
        "source_id": cfg.active,
        "destination": state["destination"],
        "local": state["local"],
        "prompt": prompt,
        "references": [{"key": r.key, "name": r.name, "url": r.url} for r in refs],
        "reference_media_ids": req.reference_media_ids,
        "estimate_seconds": cfgmod.ESTIMATE_SECONDS.get(cfg.active, 60),
    }


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The source the preview showed; refused when it is no longer selected.
    source_id: Literal["codex", "agy", "comfyui", "openai"]
    #: The prompt exactly as the preview returned and the user saw it.
    prompt: str = Field(..., min_length=1, max_length=prompting.MAX_PROMPT)
    kit_id: Optional[str] = Field(None, max_length=12)
    character_id: Optional[str] = Field(None, max_length=40)
    reference_media_ids: list[str] = Field(default_factory=list, max_length=prompting.MAX_REFERENCES)
    use_character_references: bool = True
    transparent: bool = False
    size: Size = "square"


@router.post("/images/generate")
async def images_generate(req: GenerateRequest) -> dict:
    """Start a background job; returns ``{job_id}``. Poll ``/images/jobs/{id}``."""
    cfg, _ = await asyncio.to_thread(_active_ready)
    if cfg.active != req.source_id:
        raise _err("source_changed", 409)
    kit = await asyncio.to_thread(_kit, req.kit_id)
    refs = await asyncio.to_thread(_references, req, kit)
    job = await asyncio.to_thread(
        jobs.start, source=cfg.active, prompt=req.prompt, cfg=cfg,
        references=[r.path for r in refs], reference_keys=[r.key for r in refs],
        transparent=req.transparent, size=req.size, kit_id=kit.id if kit else None,
    )
    return {"job_id": job.id}


@router.get("/images/jobs/{job_id}")
async def images_job(job_id: str) -> dict:
    """``{id, source, status, progress, stage, error, media}``; ``status`` is
    queued, running, done, failed or cancelled. ``media`` is set when done."""
    job = jobs.get(job_id)
    if job is None:
        raise _err("job_not_found", 404)
    return job.public()


@router.post("/images/jobs/{job_id}/cancel")
async def images_job_cancel(job_id: str) -> dict:
    job = jobs.cancel(job_id)
    if job is None:
        raise _err("job_not_found", 404)
    return job.public()


@router.get("/images/library")
async def images_library() -> dict:
    """Generated images still in the media library, newest first, with provenance."""
    return {"images": await asyncio.to_thread(library.list_images)}
