"""Subtitles-only video export: original audio, translated subtitles burned in.

A person who only wants burned-in subtitles translated (read on-screen
subtitles, remove them, translate, burn) never generates a dub. Every video
export used to require one: ``/dub/download`` answered 400 "No dubbed tracks
generated yet". The translations also lived only in the editor, so the job had
no text to burn. ``POST /dub/subtitle-cues`` stores the lines the editor shows
and ``/dub/download?subtitles_only=1&lang=`` burns them over the job video.
"""

from __future__ import annotations

import importlib
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

CUES = [
    {"id": "s1", "start": 0.0, "end": 1.0, "text": "Xin chào", "text_original": "你好"},
    {"id": "s2", "start": 1.0, "end": 2.0, "text": "Hẹn gặp lại", "text_original": "再见"},
]


@pytest.fixture
def app_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OMNIVOICE_DATA_DIR", str(tmp_path))
    import core.config as _cfg
    importlib.reload(_cfg)
    import core.tasks as _tasks
    importlib.reload(_tasks)
    from api.routers import dub_core as _dc
    importlib.reload(_dc)
    from api.routers import dub_export as _dx
    importlib.reload(_dx)
    import main as _main
    importlib.reload(_main)

    from fastapi.testclient import TestClient
    with TestClient(_main.app) as client:
        yield client, _dc, _dx, tmp_path


def _seed(dc, tmp_path: Path, **extra) -> tuple[str, Path]:
    job_id = f"sub_{uuid.uuid4().hex[:8]}"
    job_dir = tmp_path / "dub_jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    video = job_dir / "original.mp4"
    video.write_bytes(b"\x00" * 16)
    dc._dub_jobs[job_id] = {
        "video_path": str(video),
        "duration": 2.0,
        "filename": "clip.mp4",
        "source_lang": "zh",
        "segments": [{"id": "s1", "start": 0.0, "end": 1.0, "text": "你好"}],
        **extra,
    }
    return job_id, job_dir


class _Recorder:
    """Stands in for ffmpeg: records the command and the burned subtitle file."""

    def __init__(self):
        self.cmd: list[str] = []
        self.subtitles = ""

    async def __call__(self, cmd, *args, **kwargs):
        self.cmd = list(cmd)
        graph = cmd[cmd.index("-filter_complex") + 1]
        sub = graph.split("='", 1)[1].split("'", 1)[0].replace("\\:", ":").replace("\\\\", "\\")
        self.subtitles = Path(sub).read_text(encoding="utf-8")
        Path(cmd[-2]).write_bytes(b"mp4")
        return 0, b"", b""


def _post_cues(client, job_id, cues=CUES, lang="vi"):
    return client.post(f"/dub/subtitle-cues/{job_id}", json={"lang": lang, "cues": cues})


def test_video_with_no_dub_exports_the_translated_subtitles(app_client, monkeypatch):
    client, dc, dx, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)
    recorder = _Recorder()
    monkeypatch.setattr(dx, "run_ffmpeg", recorder)

    assert _post_cues(client, job_id).status_code == 200
    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=vi")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "video/mp4"
    assert "subtitled_clip_" in response.headers["content-disposition"]
    cmd = recorder.cmd
    # The job video only: its own audio, no dubbed track or background input.
    assert cmd.count("-i") == 1
    assert cmd[cmd.index("-map") + 1] == "[vsub]"
    assert "0:a:0?" in cmd
    assert "Xin chào" in recorder.subtitles and "Hẹn gặp lại" in recorder.subtitles
    assert "你好" not in recorder.subtitles


def test_a_regular_export_still_needs_a_dub(app_client):
    client, dc, _, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)
    _post_cues(client, job_id)

    response = client.get(f"/dub/download/{job_id}")

    assert response.status_code == 400
    assert response.json()["detail"] == "No dubbed tracks generated yet"


def test_dual_layout_burns_the_original_under_the_translation(app_client, monkeypatch):
    client, dc, dx, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)
    recorder = _Recorder()
    monkeypatch.setattr(dx, "run_ffmpeg", recorder)
    _post_cues(client, job_id)

    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=vi&dual=1")

    assert response.status_code == 200, response.text
    assert "Xin chào" in recorder.subtitles and "你好" in recorder.subtitles


def test_lines_land_over_the_removed_on_screen_subtitles(app_client, monkeypatch):
    client, dc, dx, tmp_path = app_client
    job_id, job_dir = _seed(dc, tmp_path, hardsub={"region": [0.62, 0.98]})
    (job_dir / "hardsub_cues.json").write_text(json.dumps({
        "width": 1024, "height": 576,
        "cues": [{"start": 0.0, "end": 2.0, "text": "你好", "boxes": [[358, 519, 662, 549]]}],
    }), encoding="utf-8")
    recorder = _Recorder()
    monkeypatch.setattr(dx, "run_ffmpeg", recorder)
    _post_cues(client, job_id)

    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=vi")

    assert response.status_code == 200, response.text
    graph = recorder.cmd[recorder.cmd.index("-filter_complex") + 1]
    assert ".ass'" in graph
    assert "\\pos(" in recorder.subtitles and "Xin chào" in recorder.subtitles


def test_a_generated_track_text_is_used_when_nothing_was_posted(app_client, monkeypatch):
    client, dc, dx, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path, segments_i18n={"es": {"s1": "hola"}})
    recorder = _Recorder()
    monkeypatch.setattr(dx, "run_ffmpeg", recorder)

    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=es")

    assert response.status_code == 200, response.text
    assert "hola" in recorder.subtitles


@pytest.mark.parametrize("query", ["subtitles_only=1&lang=vi", "subtitles_only=1"])
def test_nothing_to_burn_is_a_clear_400(app_client, query):
    client, dc, _, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)

    response = client.get(f"/dub/download/{job_id}?{query}")

    assert response.status_code == 400
    assert response.json()["detail"] == "No translated subtitles to burn yet"


def test_audio_jobs_cannot_burn_subtitles(app_client):
    client, dc, _, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path, input_type="audio")
    _post_cues(client, job_id)

    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=vi")

    assert response.status_code == 400


@pytest.mark.parametrize("body", [
    {"lang": "vi", "cues": []},
    {"lang": "../x", "cues": CUES},
    {"lang": "vi", "cues": [{"start": 2.0, "end": 1.0, "text": "x"}]},
])
def test_invalid_cues_are_rejected(app_client, body):
    client, dc, _, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)

    assert client.post(f"/dub/subtitle-cues/{job_id}", json=body).status_code in (400, 422)


def test_cues_for_an_unknown_job_are_404(app_client):
    client, *_ = app_client
    assert _post_cues(client, "nojob123").status_code == 404


def test_posted_cues_persist_per_language(app_client):
    client, dc, _, tmp_path = app_client
    job_id, _ = _seed(dc, tmp_path)

    assert _post_cues(client, job_id).json() == {"lang": "vi", "count": 2}
    _post_cues(client, job_id, cues=[{"start": 0.0, "end": 1.0, "text": "Hola"}], lang="es")

    stored = dc._dub_jobs[job_id]["subtitle_cues"]
    assert [cue["text"] for cue in stored["vi"]] == ["Xin chào", "Hẹn gặp lại"]
    assert stored["es"] == [{"start": 0.0, "end": 1.0, "text": "Hola"}]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs a system ffmpeg")
def test_real_export_keeps_the_original_audio_and_burns_text(app_client):
    client, dc, _, tmp_path = app_client
    job_id, job_dir = _seed(dc, tmp_path)
    video = job_dir / "original.mp4"
    subprocess.run(
        [shutil.which("ffmpeg"), "-y", "-v", "error",
         "-f", "lavfi", "-i", "color=c=black:s=320x240:r=10:d=2",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)],
        check=True, timeout=60,
    )
    _post_cues(client, job_id)

    response = client.get(f"/dub/download/{job_id}?subtitles_only=1&lang=vi")

    assert response.status_code == 200, response.text
    out = tmp_path / "out.mp4"
    out.write_bytes(response.content)
    probe = subprocess.run(
        [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type", "-of", "json", str(out)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    kinds = sorted(s["codec_type"] for s in json.loads(probe.stdout)["streams"])
    assert kinds == ["audio", "video"]
    frame = subprocess.run(
        [shutil.which("ffmpeg"), "-v", "error", "-ss", "0.5", "-i", str(out),
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True, timeout=60,
    ).stdout
    assert max(frame) > 128, "no subtitle text was burned"
