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
    # ffmpeg 7 opens "-" through the "fd" protocol, which the whitelist refuses.
    assert "-" not in enc and enc[enc.index("rawvideo") + 4] == "pipe:0"
    assert local_inputs_only(enc) == enc  # idempotent
    preset = local_inputs_only(["/x/ffmpeg", "-protocol_whitelist", "file", "-i", "-", "o.mp4"])
    assert preset == ["/x/ffmpeg", "-protocol_whitelist", "file", "-i", "pipe:0", "o.mp4"]


def test_engine_video_writer_streams_frames_through_the_whitelist(tmp_path, monkeypatch):
    """Every subtitle removal ends in VideoWriter: its stdin input must pass the whitelist."""
    import shutil

    from hardsub_core import video
    if not shutil.which("ffmpeg"):
        pytest.skip("needs a system ffmpeg")
    monkeypatch.setattr(video, "video_encoder", lambda prefer_gpu=True: ("libx264", ("-preset", "ultrafast")))
    info = video.VideoInfo("x", 64, 48, 10.0, "10/1", 5, 0.5, False)
    writer = video.VideoWriter(str(tmp_path / "o.mp4"), info, prefer_gpu=False)
    for _ in range(5):
        writer.write(np.zeros((48, 64, 3), np.uint8))
    writer.close()
    assert (tmp_path / "o.mp4").stat().st_size > 0


def _mismatched_neighbours(n):
    """Neighbours whose surroundings differ (another shot): each costs a try, none may fill."""
    out = []
    for _ in range(n):
        img = (255 - _background()).astype(np.uint8)
        out.append((img, np.ones((H, W), bool)))
    return out


def _all_valid():
    return np.ones((H, W), bool)


def test_previous_clean_frame_is_tried_after_the_neighbour_budget_runs_out():
    """Other cues' frames each expose part of the hole and use up max_tries; the previous clean
    frame must still be tried, or a static shot runs LaMa on every frame."""
    prev = (_background(), _background(), _all_valid())
    budget_only, rest = inpaint.temporal_fill(_cur(), HOLE, _mismatched_neighbours(20) + [prev[:2]])
    assert (rest == HOLE).all()  # last in `cands`: never reached once 16 tries are spent
    out, rest = inpaint.temporal_fill(_cur(), HOLE, _mismatched_neighbours(20), previous=prev)
    assert not rest.any()
    assert _err(out, _background()) < 1.0


def test_previous_clean_frame_needs_matching_surroundings():
    """A previous frame from another shot is refused like any neighbour."""
    other = _mismatched_neighbours(1)[0][0]
    _, rest = inpaint.temporal_fill(_cur(), HOLE, [], previous=(other, other, _all_valid()))
    assert (rest == HOLE).all()


def test_previous_clean_frame_is_judged_against_its_anchor_not_the_last_frame():
    """Slow drift passes every one-frame check; the patch was made for the anchor's surroundings,
    so once those no longer match, the patch is stale and must be rebuilt."""
    ys, xs = np.mgrid[0:H, 0:W]
    drifted = np.dstack([(xs + 40) * 1.5, ys * 2.5, (xs + 40 + ys)]).clip(0, 255).astype(np.uint8)
    prev = _background()  # last frame: surroundings equal the current frame's
    _, rest = inpaint.temporal_fill(_cur(), HOLE, [], previous=(prev, drifted, _all_valid()))
    assert (rest == HOLE).all()
    _, rest = inpaint.temporal_fill(_cur(), HOLE, [], previous=(prev, prev, _all_valid()))
    assert not rest.any()


def test_feather_blend_matches_the_whole_band_formula():
    rng = np.random.default_rng(1)
    orig = rng.integers(0, 256, (H, W, 3), dtype=np.uint8)
    filled = orig.copy()
    filled[HOLE] = rng.integers(0, 256, (int(HOLE.sum()), 3), dtype=np.uint8)
    m = cv2.GaussianBlur(HOLE.astype(np.float32), (0, 0), 3)
    m = np.maximum(m, HOLE.astype(np.float32))[..., None]
    want = (filled.astype(np.float32) * m + orig.astype(np.float32) * (1 - m)).astype(np.uint8)
    assert (inpaint._feather_blend(orig, filled, HOLE) == want).all()


def test_previous_clean_frame_is_refused_when_the_scene_behind_a_static_overlay_changes():
    """A subtitle's box or shadow outside the mask matches every frame; reuse must also look at
    what LaMa sees farther out, or a stale patch stays on screen while the scene changes."""
    anchor = _background()
    cur = _cur()
    cur[:30] = 255 - cur[:30]  # far from the hole (rows 60-80), a third of the context
    prev = (_background(), anchor, _all_valid())
    _, rest = inpaint.temporal_fill(cur, HOLE, [], previous=prev)
    assert (rest == HOLE).all()
    cur = _cur()
    cur[0:2, 0:20] = 255 - cur[0:2, 0:20]  # a cursor-sized change far away is tolerated
    _, rest = inpaint.temporal_fill(cur, HOLE, [], previous=prev)
    assert not rest.any()


class _CountingLama:
    size = 512

    def __init__(self):
        self.shapes = []

    def run(self, img, mask):
        self.shapes.append(img.shape[:2])
        return img


def test_lama_tiles_are_native_model_size_crops_of_the_frame():
    """A subtitle line on a 1024x576 frame takes at most two native 512 tiles, never band-high
    crops blown up to the model size (3+ runs per frame, 4x the pixels)."""
    f = inpaint.Filler("sttn", "unused", False)
    f.lama = _CountingLama()
    frame = np.zeros((576, 1024, 3), np.uint8)
    hole = np.zeros((576, 1024), bool)
    hole[506:563, 289:735] = True  # a 446-px subtitle line near the bottom
    f.fill(frame, hole)
    assert 1 <= len(f.lama.shapes) <= 2
    assert all(s == (512, 512) for s in f.lama.shapes)


def _run_static_clip(monkeypatch, n=30, lift=2):
    """A still shot whose subtitle never leaves the screen; from frame 1 on the scene is `lift`
    levels brighter. Returns (output frames, LaMa runs, hole mask)."""
    from hardsub_core.subs import Segment
    from hardsub_core.video import VideoInfo

    h, w = 120, 200
    ys, xs = np.mgrid[0:h, 0:w]
    bg = np.dstack([xs * 1.2, ys * 1.5, (xs + ys) * 0.6]).clip(0, 235).astype(np.uint8)
    frames = []
    for i in range(n):
        f = bg.copy() if i == 0 else (bg + lift).astype(np.uint8)
        cv2.rectangle(f, (60, 92), (140, 104), (255, 255, 255), -1)
        frames.append(f)

    class Cap:
        def __init__(self, _src):
            self.i = 0

        def read(self):
            if self.i >= n:
                return False, None
            self.i += 1
            return True, frames[self.i - 1].copy()

        def release(self):
            pass

    out = []

    class Writer:
        def __init__(self, *_a, **_k):
            pass

        def write(self, fr):
            out.append(fr)

        def close(self):
            pass

    runs = []

    class Lama:
        size = 512

        def __init__(self, *_a, **_k):
            self.gpu_fallback = False

        def run(self, img, mask):
            runs.append(1)
            res = img.copy()
            res[mask] = np.median(img[~mask], axis=0).astype(np.uint8)
            return res

    monkeypatch.setattr(inpaint.cv2, "VideoCapture", Cap)
    monkeypatch.setattr(inpaint, "VideoWriter", Writer)
    monkeypatch.setattr(inpaint, "LamaOnnx", Lama)
    monkeypatch.setattr(inpaint, "ensure_lama", lambda *_a, **_k: "fake.onnx")
    info = VideoInfo("v.mp4", w, h, 1.0, "1", n, float(n), False)
    seg = Segment.from_dict({"idx": 1, "start": 0.0, "end": float(n), "text": "x", "boxes": [[64, 94, 136, 102]]})
    inpaint.remove_subtitles("v.mp4", "o.mp4", info, [seg], method="lama", log=lambda _m: None)
    hole = np.zeros((h, w), bool)
    hole[94:102, 64:136] = True
    return out, len(runs), hole


def test_still_shot_runs_lama_once_then_reuses_the_fill(monkeypatch):
    out, runs, _ = _run_static_clip(monkeypatch)
    assert len(out) == 30
    assert 1 <= runs <= 2  # the first frame's tiles only, not one set per frame


def test_reused_fill_does_not_drift_frame_by_frame(monkeypatch):
    """Colour correction is applied once, to the anchor frame's output; re-correcting the previous
    frame's copy every frame walks the patch into a flat tinted box."""
    out, _, hole = _run_static_clip(monkeypatch, n=30, lift=2)
    early = out[1][hole].astype(np.float32).mean()
    late = out[-1][hole].astype(np.float32).mean()
    assert abs(late - early) < 1.0
