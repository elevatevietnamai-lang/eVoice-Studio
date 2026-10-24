"""Hardsub engine: sttn / propainter / lama / opencv fill modes (pure numpy/OpenCV, no ffmpeg)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "engines" / "hardsub"))
from hardsub_core import inpaint  # noqa: E402

H, W = 90, 160
HOLE = np.zeros((H, W), bool)
HOLE[60:80, 30:130] = True


def _background():
    ys, xs = np.mgrid[0:H, 0:W]
    return np.dstack([xs * 1.5, ys * 2.5, (xs + ys)]).clip(0, 255).astype(np.uint8)


def _candidates(n, passer_in=None):
    """n clean neighbour frames; one optionally has a bright object crossing the hole."""
    out = []
    for i in range(n):
        img = _background()
        if i == passer_in:
            img[62:78, 60:90] = 255
        out.append((img, np.ones((H, W), bool)))
    return out


def _cur():
    img = _background()
    img[HOLE] = 0
    return img


def _err(a, b):
    return float(np.abs(a[HOLE].astype(np.int16) - b[HOLE].astype(np.int16)).mean())


def test_median_rejects_a_passing_object_that_first_match_keeps():
    cands = _candidates(5, passer_in=0)
    first, _ = inpaint.temporal_fill(_cur(), HOLE, cands, median_of=1)
    med, rest = inpaint.temporal_fill(_cur(), HOLE, cands, median_of=5)
    assert not rest.any()
    assert _err(med, _background()) < 1.0
    assert _err(first, _background()) > 5.0


def test_median_uses_what_it_has_when_fewer_frames_cover_the_pixel():
    med, rest = inpaint.temporal_fill(_cur(), HOLE, _candidates(2), median_of=5)
    assert not rest.any()
    assert _err(med, _background()) < 1.0


def test_median_leaves_never_exposed_pixels_remaining():
    valid = np.ones((H, W), bool)
    valid[HOLE] = False
    cands = [(_background(), valid)] * 3
    _, rest = inpaint.temporal_fill(_cur(), HOLE, cands, median_of=3)
    assert (rest == HOLE).all()


def test_opencv_is_an_alias_of_sttn_and_needs_no_model():
    f = inpaint.Filler("opencv", "unused", prefer_gpu=False)
    assert (f.requested, f.method, f.lama) == ("sttn", "sttn", None)
    assert inpaint.Filler("sttn", "unused", False).fill(_cur(), HOLE).shape == (H, W, 3)


def test_unknown_method_is_rejected():
    with pytest.raises(ValueError):
        inpaint.Filler("nope", "unused", False)


@pytest.mark.parametrize("method", ["lama", "propainter"])
def test_lama_modes_degrade_to_sttn_when_the_model_is_unavailable(method, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("offline")

    monkeypatch.setattr(inpaint, "ensure_lama", boom)
    logs = []
    f = inpaint.Filler(method, "unused", False, log=logs.append)
    assert f.requested == method and f.method == "sttn" and f.lama is None
    assert any("LaMa" in m for m in logs)


def test_engine_media_commands_only_open_files_and_pipes():
    from hardsub_core.hw import local_inputs_only
    probe = local_inputs_only(["/x/ffprobe", "-v", "error", "clip.mp4"])
    assert probe[1:3] == ["-protocol_whitelist", "file,pipe"]
    enc = local_inputs_only(["/x/ffmpeg", "-f", "rawvideo", "-i", "-", "-i", "a.mp4", "o.mp4"])
    assert enc.count("-protocol_whitelist") == 2
    assert all(enc[i - 2:i] == ["-protocol_whitelist", "file,pipe"] for i, a in enumerate(enc) if a == "-i")
    assert local_inputs_only(enc) == enc  # idempotent
