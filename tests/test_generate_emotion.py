"""POST /generate carries a described emotion to engines that apply it (#1208).

The Clone page shows an emotion description and strength only for engines that
declare ``supports_emotion`` (IndexTTS2). These tests pin the route side:

  1. An emotion engine receives ``emo_text`` / ``use_emo_text`` / ``emo_alpha``
     on every path: whole-file, streamed single chunk and streamed chunks.
  2. Any other engine renders exactly as before: no emotion kwargs at all.
  3. A strength without a description is dropped; out-of-range values are a 422.

The engine layer is stubbed, as in test_generate_engine.py.
"""
import os

os.environ.setdefault("OMNIVOICE_MODEL", "test")
os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

import importlib

import pytest
import torch

EMOTION_KEYS = {"emo_text", "use_emo_text", "emo_alpha"}


def _tts_mod():
    # Resolved at run time: see test_generate_engine._tts_mod.
    return importlib.import_module("services.tts_backend")


def _make_engine(engine_id, *, emotion):
    class _Engine(_tts_mod().TTSBackend):
        id = engine_id
        display_name = "Emotion test engine"
        applies_own_mastering = True
        supports_emotion = emotion
        gpu_compat = ("cpu",)
        calls: list = []

        @property
        def sample_rate(self) -> int:
            return 24000

        @property
        def supported_languages(self) -> list[str]:
            return ["multi"]

        @classmethod
        def is_available(cls):
            return True, "ready"

        def generate(self, text, **kw) -> torch.Tensor:
            type(self).calls.append((text, kw))
            return torch.full((1, 24000), 0.1)

    return _Engine


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from main import app

    return TestClient(app, client=("127.0.0.1", 50000))


@pytest.fixture()
def no_omnivoice_model(monkeypatch):
    async def _boom():
        raise AssertionError("/generate fell back to the OmniVoice model")

    import api.routers.generation as gen_mod
    monkeypatch.setattr(gen_mod, "get_model", _boom)


def _use(monkeypatch, engine):
    monkeypatch.setitem(_tts_mod()._REGISTRY, engine.id, engine)
    monkeypatch.setenv("OMNIVOICE_TTS_BACKEND", engine.id)


LONG_TEXT = "First sentence is here. Second sentence follows it. Third one ends."


@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"stream": "true"},
        {"stream": "true", "max_chunk_chars": "30"},
    ],
    ids=["whole-file", "stream-single", "stream-chunks"],
)
def test_emotion_engine_receives_the_description(client, monkeypatch, no_omnivoice_model, extra):
    engine = _make_engine("emotion-engine", emotion=True)
    _use(monkeypatch, engine)

    res = client.post("/generate", data={
        "text": LONG_TEXT, "language": "Auto", "seed": "7",
        "emo_text": "  warm and proud  ", "emo_alpha": "0.45", **extra,
    })

    assert res.status_code == 200, res.text
    assert engine.calls, "the engine never ran"
    for _text, kw in engine.calls:
        assert kw["emo_text"] == "warm and proud"
        assert kw["use_emo_text"] is True
        assert kw["emo_alpha"] == pytest.approx(0.45)
    if "max_chunk_chars" in extra:
        assert len(engine.calls) > 1, "chunked stream should call the engine per chunk"


def test_other_engines_never_see_emotion(client, monkeypatch, no_omnivoice_model):
    engine = _make_engine("plain-engine", emotion=False)
    _use(monkeypatch, engine)

    res = client.post("/generate", data={
        "text": "Hello", "language": "Auto", "emo_text": "angry", "emo_alpha": "1",
    })

    assert res.status_code == 200, res.text
    assert engine.calls
    assert not EMOTION_KEYS & set(engine.calls[0][1])


def test_strength_without_description_is_dropped(client, monkeypatch, no_omnivoice_model):
    engine = _make_engine("emotion-engine-2", emotion=True)
    _use(monkeypatch, engine)

    res = client.post("/generate", data={
        "text": "Hello", "language": "Auto", "emo_text": "   ", "emo_alpha": "0.8",
    })

    assert res.status_code == 200, res.text
    assert not EMOTION_KEYS & set(engine.calls[0][1])


@pytest.mark.parametrize("field", [{"emo_alpha": "1.5"}, {"emo_alpha": "-0.1"}, {"emo_text": "x" * 501}])
def test_out_of_range_emotion_is_rejected(client, monkeypatch, no_omnivoice_model, field):
    engine = _make_engine("emotion-engine-3", emotion=True)
    _use(monkeypatch, engine)

    res = client.post("/generate", data={"text": "Hello", "language": "Auto", **field})

    assert res.status_code == 422
    assert not engine.calls
