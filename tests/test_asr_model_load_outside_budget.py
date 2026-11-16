"""A model download inside a transcribe chunk does not eat the chunk budget.

First run, Chinese source: the wav2vec2 aligner (1.27 GB) downloaded from
20:11:51 to 20:13:47 inside chunk 1's ``transcribe()``, and the 120 s chunk
budget reported "chunk 1/7 timed out" at 20:13:41 while it was still
progressing. Loads are now their own stage: excluded from the budget, capped
on their own, and visible to the caller.
"""

import ast
import asyncio
import pathlib
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from services import asr_backend
from services.asr_backend import (
    ASRTimeoutError,
    ModelLoadTracker,
    model_loading,
    run_transcribe_guarded,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _run(fn, *, timeout, tracker=None):
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return asyncio.run(run_transcribe_guarded(
            pool, fn, what="chunk", timeout=timeout, load_tracker=tracker,
        ))
    finally:
        pool.shutdown(wait=True)


def test_model_load_time_is_not_counted_against_the_chunk_budget():
    tracker = ModelLoadTracker()

    def transcribe():
        with model_loading("aligner", "zh"):
            time.sleep(0.6)  # the first-run download
        time.sleep(0.1)  # the transcription itself
        return {"chunks": ["ok"]}

    assert _run(transcribe, timeout=0.4, tracker=tracker) == {"chunks": ["ok"]}
    assert tracker.started_since(0) == [("aligner", "zh")]
    assert tracker.active() is None
    assert tracker.paused_seconds() >= 0.5  # Windows clock granularity


def test_slow_transcription_without_a_load_still_times_out():
    with pytest.raises(ASRTimeoutError):
        _run(lambda: time.sleep(0.6), timeout=0.2)


def test_a_wedged_load_is_bounded_by_its_own_cap(monkeypatch):
    monkeypatch.setattr(asr_backend, "ASR_MODEL_LOAD_TIMEOUT_S", 0.3)

    def transcribe():
        with model_loading("aligner", "zh"):
            time.sleep(0.8)

    with pytest.raises(ASRTimeoutError, match="loading the aligner model zh"):
        _run(transcribe, timeout=60)


def test_model_loading_outside_a_guarded_call_is_a_no_op():
    with model_loading("asr", "large-v3"):
        pass


def test_aligner_load_is_marked_as_a_model_load(monkeypatch):
    import sys
    import types

    seen = []
    tracker = ModelLoadTracker()
    fake = types.ModuleType("whisperx")

    def load_align_model(language_code, device):
        seen.append(tracker.active())
        return object(), {}

    fake.load_align_model = load_align_model
    monkeypatch.setitem(sys.modules, "whisperx", fake)
    monkeypatch.setattr(asr_backend, "_ALIGN_CACHE", {})
    with asr_backend._bind_load_tracker(tracker):
        assert asr_backend.load_align_model("zh", "cpu") is not None
        # Cached: no second load stage.
        asr_backend.load_align_model("zh", "cpu")
    assert seen == [("aligner", "zh")]
    assert tracker.started_since(0) == [("aligner", "zh")]


def test_dub_transcribe_reports_the_load_instead_of_a_ping():
    source = (ROOT / "backend" / "api" / "routers" / "dub_core.py").read_text(encoding="utf-8")
    assert "load_tracker=load_tracker" in source
    assert '_sse_event("model_loading"' in source


def test_transformers_safetensors_auto_conversion_is_off_by_default():
    """transformers re-downloaded the aligner as refs/pr/N model.safetensors
    (another 1.27 GB) in a background thread, and with no conversion PR it
    calls the hosted safetensors-convert Space: neither is a sanctioned
    outbound call."""
    tree = ast.parse((ROOT / "backend" / "main.py").read_text(encoding="utf-8"))
    defaults = {
        node.args[0].value: node.args[1].value
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and getattr(node.func, "attr", "") == "setdefault"
        and len(node.args) == 2
        and all(isinstance(arg, ast.Constant) for arg in node.args)
    }
    assert defaults.get("DISABLE_SAFETENSORS_CONVERSION") == "1"
