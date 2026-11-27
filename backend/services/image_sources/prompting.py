"""The exact prompt and references a generation sends, built before it is sent.

``/images/preview`` returns this to the page, the page shows it, and
``/images/generate`` sends that same text: nothing is added on the way.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

MAX_USER_PROMPT = 2000
MAX_PROMPT = 6000
MAX_REFERENCES = 6

_SHAPES = {"square": "square (1:1)", "portrait": "portrait (2:3)", "landscape": "landscape (3:2)"}


@dataclass
class Reference:
    key: str          # "media:<id>" or "kit:<kit id>:<asset id>"
    name: str
    path: str
    url: str


def reference_file_name(index: int, path: str) -> str:
    return f"reference_{index + 1}{os.path.splitext(path)[1].lower()}"


def compose(user_prompt: str, *, source: str, kit=None, character_id: Optional[str] = None,
            transparent: bool = False, size: str = "square", references: list[Reference] = ()) -> str:
    parts = [user_prompt.strip()]
    if kit is not None:
        style = kit.identity.image_style.strip()
        if style:
            parts.append(f"Visual style: {style}")
        colours = [f"{s.name or s.role} {s.hex}" for s in kit.identity.palette]
        if colours:
            parts.append("Use the brand colours: " + ", ".join(colours) + ".")
        character = next((c for c in kit.characters if c.id == character_id), None) if character_id else None
        if character is not None:
            line = f"Character: {character.name}"
            if character.appearance:
                line += f", {character.appearance}"
            if character.personality:
                line += f". Personality: {character.personality}"
            parts.append(line + ".")
    if references:
        names = ", ".join(reference_file_name(i, r.path) for i, r in enumerate(references))
        if source == "agy":
            parts.append(f"Reference images are in the refs folder ({names}); keep the subject's "
                         "appearance consistent with them.")
        else:
            parts.append("Keep the subject's appearance consistent with the attached reference images.")
    parts.append(f"Format: {_SHAPES.get(size, _SHAPES['square'])}.")
    if transparent:
        parts.append("Background: transparent (PNG with alpha).")
    if source in ("codex", "agy"):
        parts.append("Create exactly one image with your image generation tool and save it as a PNG "
                     "file in the current working directory. Do not run shell commands and do not "
                     "change any other file.")
    return "\n\n".join(p for p in parts if p)
