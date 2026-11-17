"""Exported audio tracks carry an ISO 639-2 language tag and a title.

The dub track was written with the app's two-letter code ("vi"); the MP4
muxer only packs three letters, so players showed ``language=und``. The
original track was hard-coded ``und`` even when the source language was known.
"""

import re
import shutil
import subprocess

import pytest

from api.routers.dub_export import _dub_track_title, audio_track_metadata
from core.lang_codes import iso639_2


@pytest.mark.parametrize(
    "value, expected",
    [
        ("vi", "vie"), ("zh", "zho"), ("zh-CN", "zho"), ("pt_BR", "por"),
        ("fr", "fra"), ("fre", "fra"), ("yue", "yue"), ("Vietnamese", "vie"),
        ("iw", "heb"), ("", "und"), (None, "und"), ("Auto", "und"), ("x1", "und"),
    ],
)
def test_iso639_2(value, expected):
    assert iso639_2(value) == expected


def test_track_metadata_uses_three_letter_codes_and_a_title():
    assert audio_track_metadata(1, "vi", "Vietnamese") == [
        "-metadata:s:a:1", "language=vie", "-metadata:s:a:1", "title=Vietnamese",
    ]
    assert audio_track_metadata(0, None, "") == ["-metadata:s:a:0", "language=und"]
    assert _dub_track_title("vi", {"language": "Auto"}) == "vi"
    assert _dub_track_title("vi", {"language": "Vietnamese"}) == "Vietnamese"


def _ffmpeg():
    try:
        from services.ffmpeg_utils import find_ffmpeg
        path = find_ffmpeg()
    except Exception:
        path = shutil.which("ffmpeg")
    if not path:
        pytest.skip("ffmpeg not available")
    return path


def test_mp4_mux_keeps_the_language_tags(tmp_path):
    ffmpeg = _ffmpeg()
    out = tmp_path / "dub.mp4"
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", "0.2", "-map", "0:a", "-map", "1:a", "-c:a", "aac",
        *audio_track_metadata(0, "zh", "Original"),
        *audio_track_metadata(1, "vi", "Vietnamese"),
        str(out),
    ]
    subprocess.run(cmd, check=True)
    # ffmpeg -i prints each stream as "Stream #0:1[0x2](vie): Audio: ...".
    info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(out)], capture_output=True, text=True).stderr
    langs = re.findall(r"Stream #0:\d+(?:\[0x[0-9a-f]+\])?\((\w+)\): Audio", info)
    assert langs == ["zho", "vie"], info
    # The old two-letter code is exactly what the muxer could not store.
    legacy = tmp_path / "legacy.mp4"
    subprocess.run([
        ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-t", "0.2", "-c:a", "aac", "-metadata:s:a:0", "language=vi", str(legacy),
    ], check=True)
    legacy_info = subprocess.run([ffmpeg, "-hide_banner", "-i", str(legacy)], capture_output=True, text=True).stderr
    assert "(vi)" not in legacy_info
