"""Audiogram clips from finished Audiobook / Stories renders.

Pure tier: ``services.audiogram`` clamps the slice, escapes the title, keeps
every input on a local protocol (the background is generated inside the
filter graph, never a ``lavfi`` input) and names the bundled burn font.
Route tier: ``POST /longform/audiogram`` refuses anything but a render name,
and with a real ffmpeg renders an MP4 of the requested length.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

os.environ.setdefault("OMNIVOICE_MODEL", "test")

from services import audiogram  # noqa: E402


class TestClamp:
    def test_limits_length(self):
        assert audiogram.clamp_clip(0, 9999) == (0.0, audiogram.MAX_CLIP_SECONDS)
        assert audiogram.clamp_clip(-5, 0.1) == (0.0, audiogram.MIN_CLIP_SECONDS)

    def test_stays_inside_the_program(self):
        assert audiogram.clamp_clip(50, 30, total=60) == (50.0, 10.0)
        assert audiogram.clamp_clip(100, 30, total=60) == (59.0, 1.0)


class TestTitle:
    def test_empty_title_has_no_script(self):
        assert audiogram.build_title_ass("   ", "square", 10) is None

    def test_title_uses_bundled_font_and_is_escaped(self):
        script = audiogram.build_title_ass("{\\b1} Chương một", "vertical", 12.5)
        assert "Style: Title,Inter Variable," in script
        assert "PlayResX: 1080\nPlayResY: 1920" in script
        dialogue = script.splitlines()[-1]
        assert dialogue.startswith("Dialogue: 0,0:00:00.00,0:00:12.50,Title,")
        assert "{\\b1}" not in dialogue.replace("\\{", "")
        assert "Chương một" in dialogue

    def test_title_is_capped(self):
        script = audiogram.build_title_ass("x" * 1000, "square", 5)
        assert script.splitlines()[-1].count("x") == audiogram.MAX_TITLE_CHARS


class TestCommand:
    def test_inputs_are_local_and_background_is_in_graph(self):
        cmd = audiogram.build_audiogram_cmd("ffmpeg", "/o/a.m4b", "/o/c.mp4", start=12, duration=30)
        assert "lavfi" not in cmd
        assert cmd.count("-i") == 1
        assert cmd[cmd.index("-i") - 2:cmd.index("-i")] == ["-protocol_whitelist", "file,pipe"]
        graph = cmd[cmd.index("-filter_complex") + 1]
        assert "color=c=" in graph and "showwaves=" in graph and graph.endswith("[v]")
        assert cmd[cmd.index("-ss") + 1] == "12.000" and cmd[cmd.index("-t") + 1] == "30.000"
        assert cmd[-1] == "/o/c.mp4" and "+faststart" in cmd

    def test_cover_is_composed_once_and_title_runs_last(self):
        cmd = audiogram.build_audiogram_cmd(
            "ffmpeg", "a.m4b", "c.mp4", start=0, duration=5, shape="landscape",
            cover_path="cover.png", title_filter="ass='t.ass'",
        )
        assert cmd.count("-i") == 2 and "-loop" not in cmd
        # The still cover is composed once and repeated, never blurred per frame.
        assert "loop=loop=-1:size=1" in cmd[cmd.index("-filter_complex") + 1]
        graph = cmd[cmd.index("-filter_complex") + 1]
        assert "[1:v]split" in graph and "color=c=" not in graph
        assert graph.endswith("[waved]ass='t.ass'[v]")
        assert "1280x" not in graph and "scale=1280:720" in graph

    def test_unknown_shape_raises(self):
        with pytest.raises(ValueError):
            audiogram.build_audiogram_cmd("ffmpeg", "a", "b", start=0, duration=1, shape="round")


@pytest.fixture()
def client_and_outputs(tmp_path, monkeypatch):
    from core import config

    monkeypatch.setattr(config, "OUTPUTS_DIR", str(tmp_path))
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        yield client, tmp_path


class TestRoute:
    @pytest.mark.parametrize("name", ["../secret.m4b", "audiogram_x.mp4", "story_a.wav", "x.m4b"])
    def test_rejects_anything_but_a_render(self, client_and_outputs, name):
        client, _ = client_and_outputs
        res = client.post("/longform/audiogram", json={"output": name})
        assert res.status_code == 404

    def test_rejects_unknown_shape(self, client_and_outputs):
        client, _ = client_and_outputs
        res = client.post("/longform/audiogram", json={"output": "story_a.m4b", "shape": "round"})
        assert res.status_code == 422

    def test_renders_a_real_clip(self, client_and_outputs):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        if not ffmpeg or not ffprobe:
            pytest.skip("ffmpeg/ffprobe are not installed")
        client, outputs = client_and_outputs
        render = outputs / "audiobook_t1.m4b"
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
             "-i", "sine=frequency=330:duration=6", "-c:a", "aac", "-f", "mp4", str(render)],
            check=True,
        )
        res = client.post("/longform/audiogram", json={
            "output": render.name, "start": 2, "duration": 30,
            "shape": "landscape", "title": "Chương 1: Người về",
        })
        assert res.status_code == 200, res.text[:800]
        body = res.json()
        # Clamped to the 4 s left in the 6 s program.
        assert body["start"] == 2.0 and body["duration"] == pytest.approx(4.0, abs=0.1)
        clip = outputs / body["output"]
        assert clip.is_file() and not list(outputs.glob(".audiogram_*.ass"))
        probe = json.loads(subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
             "-of", "json", str(clip)],
            check=True, capture_output=True, text=True,
        ).stdout)
        kinds = {s["codec_type"]: s for s in probe["streams"]}
        assert kinds["video"]["width"] == 1280 and kinds["video"]["height"] == 720
        assert "audio" in kinds
        assert float(probe["format"]["duration"]) == pytest.approx(4.0, abs=0.3)
