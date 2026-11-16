"""Hardsub engine: which onnxruntime provider really runs, and the GPU lock that feeds it.

onnxruntime keeps listing CUDAExecutionProvider when its DLLs cannot load and quietly runs the
session on the CPU. A 3-minute OCR then took 15 minutes on an RTX 3060 because
onnxruntime-gpu 1.31 (built for CUDA 13) was installed next to CUDA 12 wheels.
"""
from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1] / "backend" / "engines" / "hardsub"
sys.path.insert(0, str(ENGINE))
from hardsub_core import hw  # noqa: E402

CPU = "CPUExecutionProvider"
CUDA = "CUDAExecutionProvider"


@pytest.mark.parametrize("requested, active, fallback", [
    ((CUDA, CPU), (CUDA, CPU), False),
    ((CUDA, CPU), (CPU,), True),                       # CUDA dropped silently
    (("DmlExecutionProvider", CPU), (CPU,), True),
    (("CoreMLExecutionProvider", CPU), ("CoreMLExecutionProvider", CPU), False),
    ((CPU,), (CPU,), False),                           # CPU asked for: nothing to warn about
    ((), (CPU,), False),
])
def test_gpu_fallback(requested, active, fallback):
    assert hw.gpu_fallback(requested, active) is fallback


def test_accelerator_names_the_first_gpu_provider():
    assert hw.accelerator(["TensorrtExecutionProvider", CUDA, CPU]) == "CUDA"
    assert hw.accelerator(["DmlExecutionProvider", CPU]) == "DirectML"
    assert hw.accelerator([CPU]) == "CPU"
    assert hw.accelerator([]) == "CPU"


def _fake_ort(monkeypatch, available):
    mod = types.ModuleType("onnxruntime")
    mod.get_available_providers = lambda: list(available)
    monkeypatch.setitem(sys.modules, "onnxruntime", mod)
    hw.ort_providers.cache_clear()


def test_ort_providers_order(monkeypatch):
    _fake_ort(monkeypatch, ["TensorrtExecutionProvider", CUDA, CPU])
    assert hw.ort_providers(True) == (CUDA, CPU)
    assert hw.ort_providers(False) == (CPU,)
    _fake_ort(monkeypatch, [CPU])
    assert hw.ort_providers(True) == (CPU,)
    hw.ort_providers.cache_clear()


def _session(providers):
    return types.SimpleNamespace(get_providers=lambda: list(providers))


@pytest.fixture
def ocr(monkeypatch):
    pytest.importorskip("numpy")
    pytest.importorskip("cv2")
    from hardsub_core import ocr as mod
    return mod


@pytest.mark.parametrize("active, fallback", [((CUDA, CPU), False), ((CPU,), True)])
def test_ocr_engine_reports_the_session_provider(monkeypatch, ocr, active, fallback):
    """RapidOCR asked for CUDA; the created session decides whether we warn."""
    made = {}

    class FakeRapid:
        def __init__(self, **kw):
            made.update(kw)
            part = types.SimpleNamespace(infer=types.SimpleNamespace(session=_session(active)))
            self.text_det = self.text_cls = self.text_rec = part

    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime",
                        types.SimpleNamespace(RapidOCR=FakeRapid))
    monkeypatch.setattr(ocr, "ort_providers", lambda prefer=True: (CUDA, CPU))
    engine = ocr.OcrEngine(True)
    assert made["rec_use_cuda"] is True
    assert engine.active == active
    assert engine.gpu_fallback is fallback


def test_ocr_engine_on_cpu_by_choice_never_warns(monkeypatch, ocr):
    class FakeRapid:
        def __init__(self, **kw):
            assert kw["det_use_cuda"] is False
            self.text_rec = types.SimpleNamespace(infer=types.SimpleNamespace(session=_session([CPU])))

    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime",
                        types.SimpleNamespace(RapidOCR=FakeRapid))
    monkeypatch.setattr(ocr, "ort_providers", lambda prefer=True: (CUDA, CPU))
    assert ocr.OcrEngine(False).gpu_fallback is False


# ── the GPU lock: onnxruntime-gpu and the nvidia wheels must target the same CUDA major

def _pins(lock: Path) -> dict[str, str]:
    pins = {}
    for line in lock.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Za-z0-9_.\-]+)==([^\s;\\]+)", line)
        if m:
            pins[m.group(1).lower()] = m.group(2)
    return pins


def test_gpu_lock_cuda_major_matches_onnxruntime():
    pins = _pins(ENGINE / "locks" / "ort-gpu.lock")
    major, minor = (int(x) for x in pins["onnxruntime-gpu"].split(".")[:2])
    # PyPI onnxruntime-gpu: 1.19–1.26 are CUDA 12 builds, 1.27 and later are CUDA 13.
    cuda = 13 if (major, minor) >= (1, 27) else 12
    nvidia = [name for name in pins if name.startswith("nvidia-")]
    assert nvidia, "the GPU lock must ship the CUDA runtime wheels"
    wrong = [n for n in nvidia if not n.endswith(f"-cu{cuda}") and re.search(r"-cu\d+$", n)]
    assert not wrong, f"onnxruntime-gpu {pins['onnxruntime-gpu']} needs CUDA {cuda} wheels, got {wrong}"
    for need in ("cublas", "cudnn", "cuda-runtime", "cufft", "curand"):
        assert any(need in n for n in nvidia), f"missing nvidia {need} wheel"


# ── fixed text inside the subtitle band (app UI, watermarks)

def test_static_overlays_drop_ui_labels_but_keep_subtitles(ocr):
    period = 0.25                                   # 4 samples per second
    ui = ([100.0, 900.0, 400.0, 930.0], "Width Height Batch size")
    raw = []
    for i in range(240):                            # 60 s
        lines = [ui]
        # a new subtitle every 3 s, slightly jittering box
        n = i // 12
        lines.append(([600.0 + (i % 3), 960.0, 1300.0, 1000.0 + (i % 2)], f"line {n}"))
        raw.append((i * period, lines))
    static = ocr.static_overlays(raw, period)
    assert ocr._overlay_key(*ui) in static
    assert not any(k[0].startswith("line") for k in static)


def test_static_overlays_keep_everything_in_short_videos(ocr):
    raw = [(i * 0.25, [([0.0, 900.0, 300.0, 930.0], "Only line")]) for i in range(30)]  # 7.5 s
    assert ocr.static_overlays(raw, 0.25) == set()


def test_static_overlays_long_unbroken_run(ocr):
    """Under the share threshold but on screen without a break for 20 s: still an overlay."""
    raw = []
    for i in range(1200):                           # 5 min
        lines = [([0.0, 900.0, 300.0, 930.0], "Sticker")] if 100 <= i < 180 else []
        raw.append((i * 0.25, lines))
    assert len(ocr.static_overlays(raw, 0.25)) == 1


# ── an existing install picks up a new lock instead of keeping a stale runtime

def test_install_marker_tracks_the_lock_fingerprint(monkeypatch, tmp_path):
    import json

    from services import hardsub

    monkeypatch.setattr(hardsub, "engine_dir", lambda: tmp_path)
    py = hardsub.venv_python()
    py.parent.mkdir(parents=True)
    py.write_text("")
    marker = tmp_path / ".install-complete"

    # An engine installed before the fingerprint existed (the CUDA 13 / CUDA 12 mix-up).
    marker.write_text(json.dumps({"providers": [CUDA, CPU]}), encoding="utf-8")
    assert hardsub.is_installed() is False
    assert hardsub.status()["needs_update"] is True

    marker.write_text(json.dumps({"locks": hardsub.lock_fingerprint()}), encoding="utf-8")
    assert hardsub.is_installed() is True
    assert hardsub.status()["needs_update"] is False


# ── boundary refinement reads the known line boxes without detection

def test_refine_boundaries_uses_recognition_only(ocr, tmp_path):
    import numpy as np
    import cv2
    from hardsub_core.subs import Segment
    from hardsub_core.video import VideoInfo

    path = str(tmp_path / "v.avi")
    w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 25, (160, 90))
    for _ in range(60):
        w.write(np.zeros((90, 160, 3), np.uint8))
    w.release()
    info = VideoInfo(path, 160, 90, 25.0, "25/1", 60, 2.4, False)

    class Engine:
        frame_index = 0
        crops = []

        def __call__(self, img):  # detection path must not run
            raise AssertionError("refine ran detection")

        def recognize(self, crops):
            self.crops.append([c.shape for c in crops])
            on = 13 <= self.frame_index <= 41      # the line is really on frames 13..41
            return [("Hello" if on else "", 0.99)]

    seg = Segment(1, 0.6, 1.6, "Hello", [[20.0, 60.0, 140.0, 80.0]])
    seg._f0, seg._f1 = 16, 40                      # first / last sampled frame with text
    eng = Engine()
    ocr.refine_boundaries(path, info, [seg], eng, step=6)
    assert round(seg.start * 25) == 13 and round(seg.end * 25) == 42
    assert all(len(shapes) == 1 and shapes[0][0] < 90 for shapes in eng.crops)


def test_small_off_centre_text_is_not_a_subtitle(ocr):
    """App labels and speech bubbles are much smaller than the centred subtitle line."""
    W = 1024
    sub = lambda n: ([312.0, 483.0, 712.0, 515.0], f"line {n}")       # 32 px, centred
    raw = [(i * 0.25, [sub(i // 8)] + ([([374.0, 380.0, 403.0, 390.0], "label")] if i % 3 else []))
           for i in range(40)]
    h = ocr.subtitle_line_height(raw, W)
    assert h == 32.0
    assert 10.0 < h * ocr.SMALL_TEXT_RATIO <= 32.0
    assert ocr.subtitle_line_height([(0.0, [([0.0, 0.0, 100.0, 10.0], "x")])], W) == 0.0
