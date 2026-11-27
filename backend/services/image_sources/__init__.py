"""Image sources: optional generators the user picks in Settings → Image sources.

Off by default. Nothing here runs, probes the network or starts a CLI until the
user selects a source, and each generation is a separate request the page makes
after showing the user the exact prompt, the reference images and where they
go. The sources:

* ``codex`` — the user's own Codex CLI (``codex exec``) in a fresh temp folder;
  the images go to OpenAI through the account signed in to that CLI.
* ``agy`` — the user's own Antigravity CLI; the images go to Google through the
  account signed in to that CLI.
* ``comfyui`` — a ComfyUI server the user runs on this machine (loopback only,
  or a network listed in ``OMNIVOICE_TRUSTED_NETWORKS``).
* ``openai`` — an OpenAI-style ``/images`` API with the user's own key.

A result is checked (Pillow, size, pixel count) and added to the media library
the promo builder and video editor read (``OUTPUTS_DIR/promo_media``) with a
provenance record (prompt, source, time, "AI image" label).
"""

from __future__ import annotations

from .config import (  # noqa: F401
    SOURCE_IDS,
    SourceConfig,
    describe_sources,
    load_config,
    save_config,
)
