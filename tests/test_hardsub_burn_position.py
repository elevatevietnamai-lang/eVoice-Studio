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
