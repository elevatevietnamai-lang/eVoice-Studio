"""Brand compliance check: a project description against a Channel Kit.

Pure and local: no LLM, no I/O. The caller (the video editor, the agent, the
promo page) describes its project in the neutral ``ProjectDescriptor`` shape
below, with boxes as fractions of the frame (0..1, origin top-left) so the
same check works at every aspect ratio. Each issue names the clip it belongs
to (``None`` for project-wide ones) and a stable ``code`` the UI localizes.
"""

from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from services.channel_kit import ChannelFormat, Kit, SafeZone

#: Colours closer than this (CIE76 ΔE) count as the same brand colour.
COLOR_TOLERANCE = 12.0
NEUTRALS = ("#ffffff", "#000000")
GENERIC_FONTS = frozenset({"sans-serif", "serif", "monospace", "system-ui"})

#: Parts of a vertical frame each platform covers with its own buttons and
#: captions (fractions). Approximate public guidance; a Kit format overrides.
DEFAULT_SAFE_ZONES: dict[str, SafeZone] = {
    "tiktok": SafeZone(top=0.09, bottom=0.2, left=0.04, right=0.15),
    "reels": SafeZone(top=0.1, bottom=0.2, left=0.04, right=0.12),
    "shorts": SafeZone(top=0.08, bottom=0.18, left=0.04, right=0.13),
    "facebook": SafeZone(top=0.1, bottom=0.2, left=0.04, right=0.12),
    "youtube": SafeZone(top=0.0, bottom=0.1, left=0.0, right=0.0),
    "other": SafeZone(),
}

Bbox = list[float]


class Clip(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., max_length=80)
    kind: Literal["text", "caption", "logo", "video", "image", "scene", "audio", "sticker", "other"] = "other"
    start: float = Field(0.0, ge=0)
    duration: float = Field(0.0, ge=0)
    bbox: Optional[Bbox] = Field(None, min_length=4, max_length=4)
    text: str = Field("", max_length=5000)
    font: str = Field("", max_length=120)
    color: str = Field("", max_length=16)
    colors: list[str] = Field(default_factory=list, max_length=32)
    logo_variant: str = Field("", max_length=40)
    asset: str = Field("", max_length=40)
    voice_id: str = Field("", max_length=120)
    transition: str = Field("", max_length=60)


class ProjectDescriptor(BaseModel):
    model_config = ConfigDict(extra="ignore")

    platform: Literal["tiktok", "reels", "shorts", "youtube", "facebook", "other"] = "other"
    aspect: str = Field("9:16", max_length=8)
    format_id: Optional[str] = Field(None, max_length=40)
    duration: Optional[float] = Field(None, ge=0)
    #: The project contains AI-generated media (images, cloned voice…).
    ai_content: bool = False
    clips: list[Clip] = Field(default_factory=list, max_length=2000)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _hex_to_lab(value: str) -> Optional[tuple[float, float, float]]:
    value = value.strip().lower()
    if len(value) == 4 and value.startswith("#"):
        value = "#" + "".join(ch * 2 for ch in value[1:])
    if len(value) != 7 or not value.startswith("#"):
        return None
    try:
        rgb = [int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    except ValueError:
        return None
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047
    y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722
    z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(a: str, b: str) -> float:
    la, lb = _hex_to_lab(a), _hex_to_lab(b)
    if la is None or lb is None:
        return math.inf
    return math.dist(la, lb)


def _overlap(a: Bbox, b: Bbox) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def _times_overlap(a: Clip, b: Clip) -> bool:
    return a.start < b.start + b.duration and b.start < a.start + a.duration


def _ui_zones(zone: SafeZone) -> list[Bbox]:
    boxes = []
    if zone.top:
        boxes.append([0.0, 0.0, 1.0, zone.top])
    if zone.bottom:
        boxes.append([0.0, 1.0 - zone.bottom, 1.0, zone.bottom])
    if zone.left:
        boxes.append([0.0, 0.0, zone.left, 1.0])
    if zone.right:
        boxes.append([1.0 - zone.right, 0.0, zone.right, 1.0])
    return boxes


def _format_for(kit: Kit, project: ProjectDescriptor) -> Optional[ChannelFormat]:
    if project.format_id:
        return next((f for f in kit.formats if f.id == project.format_id), None)
    return next((f for f in kit.formats if f.platform == project.platform), None)


def _issue(code: str, clip: Optional[Clip], severity: str = "error", **detail) -> dict:
    return {"clip_id": clip.id if clip else None, "code": code, "severity": severity, "detail": detail}


def _norm(text: str) -> str:
    return " ".join(text.casefold().split())


# ── The check ────────────────────────────────────────────────────────────────

def check(kit: Kit, project: ProjectDescriptor) -> list[dict]:
    issues: list[dict] = []
    palette = [s.hex for s in kit.identity.palette]
    if kit.identity.allow_neutrals:
        palette += list(NEUTRALS)
    fonts = {f.family.casefold() for f in kit.identity.fonts}
    if kit.captions.font:
        fonts.add(kit.captions.font.casefold())
    logos = kit.identity.logos
    logo_variants = {l.variant for l in logos}
    logo_assets = {l.asset for l in logos if l.asset}
    voices = {v for v in [kit.audio.brand_voice_id, *(c.voice_id for c in kit.characters)] if v}
    transitions = {t.casefold() for t in kit.motion.transitions_allowed}
    banned = [w for w in kit.voice_tone.banned_words if w.strip()]
    fmt = _format_for(kit, project)
    zone = (fmt.safe_zone if fmt and fmt.safe_zone else None) or DEFAULT_SAFE_ZONES.get(project.platform)
    ui_boxes = _ui_zones(zone) if zone else []
    texts = [c for c in project.clips if c.kind in ("text", "caption")]
    all_text = _norm(" ".join(c.text for c in texts))

    for clip in project.clips:
        if palette and kit.identity.palette:
            for colour in [clip.color, *clip.colors]:
                if not colour:
                    continue
                nearest = min(palette, key=lambda p: delta_e(colour, p))
                if delta_e(colour, nearest) > COLOR_TOLERANCE:
                    issues.append(_issue("color_off_palette", clip, color=colour.lower(), nearest=nearest))
        if clip.font and fonts and clip.font.casefold() not in fonts | GENERIC_FONTS:
            issues.append(_issue("font_off_kit", clip, font=clip.font,
                                 allowed=sorted(f.family for f in kit.identity.fonts)))
        if clip.kind == "logo" and logos:
            wrong_variant = clip.logo_variant and clip.logo_variant not in logo_variants
            wrong_asset = clip.asset and clip.asset not in logo_assets
            if wrong_variant or wrong_asset:
                issues.append(_issue("logo_wrong_variant", clip, variant=clip.logo_variant or None,
                                     allowed=sorted(logo_variants)))
            logo = next((l for l in logos if (clip.asset and l.asset == clip.asset)
                         or (not clip.asset and l.variant == (clip.logo_variant or "primary"))), None)
            if logo and clip.bbox and logo.clear_space > 0:
                x, y, w, h = clip.bbox
                pad = logo.clear_space * w
                guard = [x - pad, y - pad, w + 2 * pad, h + 2 * pad]
                for other in project.clips:
                    if other is clip or not other.bbox or other.kind in ("audio", "video", "image"):
                        continue
                    if _times_overlap(clip, other) and _overlap(guard, other.bbox):
                        issues.append(_issue("logo_clear_space", clip, other=other.id))
            if logo and clip.bbox and logo.min_width and clip.bbox[2] < logo.min_width:
                issues.append(_issue("logo_too_small", clip, "warning", min_width=logo.min_width))
        if clip.kind in ("text", "caption", "logo") and clip.bbox and ui_boxes:
            if any(_overlap(clip.bbox, box) for box in ui_boxes):
                issues.append(_issue("text_in_platform_ui", clip, "warning", platform=project.platform))
        if clip.kind == "audio" and clip.voice_id and voices and clip.voice_id not in voices:
            issues.append(_issue("voice_not_brand", clip, voice_id=clip.voice_id))
        if clip.transition and transitions and clip.transition.casefold() not in transitions:
            issues.append(_issue("transition_not_allowed", clip, "warning", transition=clip.transition,
                                 allowed=sorted(kit.motion.transitions_allowed)))
        if clip.text and banned:
            text = _norm(clip.text)
            hits = [w for w in banned if _norm(w) in text]
            if hits:
                issues.append(_issue("banned_word", clip, words=hits))

    if kit.voice_tone.ctas and not any(_norm(cta) in all_text for cta in kit.voice_tone.ctas):
        issues.append(_issue("missing_cta", None, "warning", ctas=list(kit.voice_tone.ctas)))
    if kit.legal.disclaimer and _norm(kit.legal.disclaimer) not in all_text:
        issues.append(_issue("missing_disclaimer", None, disclaimer=kit.legal.disclaimer))
    if kit.legal.ai_label and project.ai_content:
        label = _norm(kit.legal.ai_label_text) if kit.legal.ai_label_text else ""
        if not label or label not in all_text:
            issues.append(_issue("missing_ai_label", None, label=kit.legal.ai_label_text or None))
    if fmt and project.duration is not None:
        too_short = fmt.duration_min and project.duration < fmt.duration_min
        too_long = fmt.duration_max and project.duration > fmt.duration_max
        if too_short or too_long:
            issues.append(_issue("duration_out_of_format", None, "warning", duration=project.duration,
                                 min=fmt.duration_min or None, max=fmt.duration_max or None,
                                 format_id=fmt.id))
    if fmt and fmt.aspect and project.aspect and fmt.aspect != project.aspect:
        issues.append(_issue("aspect_out_of_format", None, "warning", aspect=project.aspect,
                             expected=fmt.aspect, format_id=fmt.id))
    return issues
