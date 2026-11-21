"""/dub/translate without a `provider` uses the engine Settings chose, never Google by default."""
from __future__ import annotations

import os

os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

from api.routers import dub_translate  # noqa: E402
from core import prefs  # noqa: E402


def test_no_provider_uses_the_saved_engine(monkeypatch):
    monkeypatch.delenv("TRANSLATE_PROVIDER", raising=False)
    monkeypatch.setattr(prefs, "get", lambda key, default=None: "nllb" if key == "translation_backend" else default)
    assert dub_translate.default_translation_provider() == "nllb"


def test_no_provider_and_no_saved_engine_is_local_argos(monkeypatch):
    monkeypatch.delenv("TRANSLATE_PROVIDER", raising=False)
    monkeypatch.setattr(prefs, "get", lambda key, default=None: default)
    assert dub_translate.default_translation_provider() == "argos"


def test_env_override_wins(monkeypatch):
    monkeypatch.setenv("TRANSLATE_PROVIDER", "OpenAI")
    monkeypatch.setattr(prefs, "get", lambda key, default=None: "nllb")
    assert dub_translate.default_translation_provider() == "openai"
