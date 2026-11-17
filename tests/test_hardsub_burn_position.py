"""Burned translations land where the removed on-screen subtitles were.

The OCR'd boxes give the real text line; the scanned region is only the area
the person searched, usually much taller than the text. Placing the burn at
the bottom of that region put translations below the cleaned-up spot and at
a fixed size, so they no longer covered where the original line had been.
"""
from __future__ import annotations

import os
import shutil
import subprocess

import pytest

os.environ.setdefault("OMNIVOICE_MODEL", "test")

np = pytest.importorskip("numpy")

# A 1024x576 frame whose subtitles sit in boxes spanning y 519..549.
CUES = {
    "width": 1024,
    "height": 576,
    "cues": [
        {"start": 0.0, "end": 1.0, "text": "a", "boxes": [[358.0, 519.0, 662.0, 549.0]]},
        {"start": 1.0, "end": 2.0, "text": "b", "boxes": [[300.0, 520.0, 700.0, 549.0]]},
        # Two lines: only the lowest one sets the bottom edge and the size.
        {"start": 2.0, "end": 3.0, "text": "c\nd",
         "boxes": [[380.0, 480.0, 640.0, 510.0], [370.0, 518.0, 650.0, 548.0]]},
        {"start": 3.0, "end": 4.0, "text": "e", "boxes": []},
    ],
}


def test_text_line_is_the_median_lowest_line():
    from api.routers.dub_hardsub import _text_line

    line = _text_line(CUES)
    assert line == {"bottom": round(549 / 576, 4), "height": round(30 / 576, 4)}


@pytest.mark.parametrize("data", [{"height": 576, "cues": []}, {"cues": CUES["cues"]},
                                  {"height": 576, "cues": [{"boxes": [[0, 5, 9, 5]]}]}])
def test_text_line_is_unknown_without_usable_boxes(data):
    from api.routers.dub_hardsub import _text_line

    assert _text_line(data) is None


def test_jobs_read_before_text_line_keep_the_region_placement():
    from api.routers.dub_export import _hardsub_burn_style

    style = _hardsub_burn_style({"hardsub": {"region": [0.8, 0.95]}})
    assert "MarginV=16,Fontsize=18" in style


def _burned_rows(job: dict, tmp_path) -> tuple[int, int]:
    from api.routers.dub_export import subtitle_burn_filter

    caption = tmp_path / "burn.srt"
    caption.write_text("1\n00:00:00,000 --> 00:00:01,000\nNgười ấy đã về thật rồi\n",
                       encoding="utf-8")
    graph = subtitle_burn_filter("[0:v]", str(caption), "[v]", job=job, is_ass=False)
    raw = subprocess.run(
        [shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
         "color=c=black:s=1024x576:r=1:d=1", "-filter_complex", graph, "-map", "[v]",
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True, timeout=60,
    ).stdout
    frame = np.frombuffer(raw, np.uint8).reshape(576, 1024)
    rows = np.where((frame > 128).any(axis=1))[0]
    assert rows.size, "nothing was burned"
    return int(rows.min()), int(rows.max())


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs a system ffmpeg")
def test_burned_line_covers_the_original_text_line(tmp_path):
    from api.routers.dub_hardsub import _text_line

    # The default scan region (62%..98%) is far taller than the text.
    job = {"hardsub": {"region": [0.62, 0.98], "text_line": _text_line(CUES)}}
    top, bottom = _burned_rows(job, tmp_path)
    assert abs(top - 519) <= 4 and abs(bottom - 549) <= 4, (top, bottom)


# A video whose subtitles move: a talking head (line at y 519..549), then a
# screen recording with the line higher up (y 482..514), as in real tutorials.
MOVING = {
    "width": 1024,
    "height": 576,
    "region": [0.8, 0.965],
    "cues": [
        {"start": 0.0, "end": 1.0, "text": "a", "boxes": [[358.0, 519.0, 662.0, 549.0]]},
        {"start": 1.0, "end": 2.0, "text": "b", "boxes": [[200.0, 482.0, 500.0, 514.0]]},
    ],
}


def _job_with_moving_cues(tmp_path):
    import json

    from api.routers.dub_hardsub import CUES_FILE

    (tmp_path / CUES_FILE).write_text(json.dumps(MOVING), encoding="utf-8")
    exports = tmp_path / "exports"
    exports.mkdir()
    job = {
        "hardsub": {"region": MOVING["region"]},
        "segments": [
            {"id": 0, "start": 0.0, "end": 1.0, "text": "Người ấy đã về thật rồi"},
            {"id": 1, "start": 1.05, "end": 1.95, "text": "Người ấy đã về thật rồi"},
            {"id": 2, "start": 5.0, "end": 6.0, "text": "no cue here"},
        ],
    }
    return job, exports


def test_each_cue_is_placed_on_its_own_original_line(tmp_path):
    from api.routers.dub_export import _hardsub_cue_places

    job, _ = _job_with_moving_cues(tmp_path)
    play_res, places = _hardsub_cue_places(job, str(tmp_path), job["segments"])
    assert play_res == (1024, 576)
    assert places == [(510.0, 549.0, 30), (350.0, 514.0, 32), None]  # None: no OCR'd cue overlaps


def test_cue_places_need_a_read_region_and_the_cues_file(tmp_path):
    from api.routers.dub_export import _hardsub_cue_places

    job, _ = _job_with_moving_cues(tmp_path)
    assert _hardsub_cue_places({"segments": job["segments"]}, str(tmp_path), job["segments"]) is None
    assert _hardsub_cue_places(job, str(tmp_path / "missing"), job["segments"]) is None


def test_placed_burn_is_an_ass_script_because_srt_drops_position_tags(tmp_path):
    # ffmpeg's SRT reader keeps only {\anN}: {\pos} and {\fs} never reach libass.
    from api.routers.dub_export import _write_burn_srt

    job, exports = _job_with_moving_cues(tmp_path)
    path = _write_burn_srt(job, str(exports), "t", True)
    assert path.endswith(".ass")
    with open(path, encoding="utf-8") as f:
        script = f.read()
    assert "PlayResX: 1024" in script and "PlayResY: 576" in script
    assert r"{\an2\pos(510,549)\fs30}Người ấy" in script
    assert r"{\an2\pos(350,514)\fs32}" in script
    assert ",Default,,0,0,0,,no cue here" in script  # unmatched: the style's own placement


def test_jobs_without_read_subtitles_keep_the_srt_burn(tmp_path):
    from api.routers.dub_export import _write_burn_srt

    job, exports = _job_with_moving_cues(tmp_path)
    job.pop("hardsub")
    assert _write_burn_srt(job, str(exports), "t", False).endswith(".srt")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs a system ffmpeg")
def test_burned_lines_follow_subtitles_that_move(tmp_path):
    from api.routers.dub_export import _write_burn_srt, subtitle_burn_filter

    job, exports = _job_with_moving_cues(tmp_path)
    srt = _write_burn_srt(job, str(exports), "t", False)
    graph = subtitle_burn_filter("[0:v]", srt, "[v]", job=job, is_ass=False)
    raw = subprocess.run(
        [shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
         "color=c=black:s=1024x576:r=10:d=2", "-filter_complex", graph, "-map", "[v]",
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True, timeout=60,
    ).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, 576, 1024)
    # Frame 5 is at 0.5 s (talking head), frame 15 at 1.5 s (screen recording).
    for index, (top, bottom, centre) in ((5, (519, 549, 510)), (15, (482, 514, 350))):
        lit = frames[index] > 128
        rows = np.where(lit.any(axis=1))[0]
        cols = np.where(lit.any(axis=0))[0]
        assert abs(int(rows.min()) - top) <= 4 and abs(int(rows.max()) - bottom) <= 4, (index, rows.min(), rows.max())
        assert abs((int(cols.min()) + int(cols.max())) / 2 - centre) <= 6, (index, cols.min(), cols.max())
