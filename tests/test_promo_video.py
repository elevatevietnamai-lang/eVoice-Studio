"""Promo video builder.

Pure tier: ``services.promo_video`` computes the timeline the same way the
filter graph joins shots (``offset = length - transition``), normalises every
shot before ``xfade``, keeps inputs on local protocols, validates plans, and
snaps cuts to a detected beat grid.
Route tier: ``POST /promo/media`` stores only allow-listed media under a
random id; ``POST /promo/render`` resolves ids inside that folder and, with a
real ffmpeg, renders an MP4 of the planned size, frame count and length from
clips of different sizes and rates, a still, a logo and music.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import numpy as np
import pytest

os.environ.setdefault("OMNIVOICE_MODEL", "test")

from services import promo_video as pv  # noqa: E402


def _plan(**kwargs) -> pv.PromoPlan:
    shots = kwargs.pop("shots", [
        pv.Shot("a.mp4", "video", 3.0, transition="cut"),
        pv.Shot("b.mp4", "video", 2.0, transition="fade", transition_seconds=0.5),
        pv.Shot("c.png", "image", 2.0, transition="flash", transition_seconds=0.4),
    ])
    return pv.PromoPlan(shots=shots, **kwargs)


class TestTimeline:
    def test_length_subtracts_each_transition(self):
        assert pv.program_length(_plan()) == pytest.approx(3.0 + 2.0 - 0.5 + 2.0 - 0.4)

    def test_cut_adds_full_length(self):
        shots = [pv.Shot("a.mp4", "video", 2.0), pv.Shot("b.mp4", "video", 2.0, transition="cut")]
        assert pv.program_length(_plan(shots=shots)) == pytest.approx(4.0)

    def test_starts_follow_the_overlaps(self):
        assert pv.segment_starts(_plan()) == [0.0, 2.5, 4.1]

    def test_transition_never_eats_a_short_shot(self):
        assert pv.clamp_transition(2.0, 1.0, 5.0) == pytest.approx(0.45)
        assert pv.clamp_transition(0.3, 4.0, 4.0) == pytest.approx(0.3)

    def test_outro_needs_a_logo(self):
        no_logo = _plan(brand=pv.Brand(outro_seconds=3))
        with_logo = _plan(brand=pv.Brand(logo_path="l.png", outro_seconds=3))
        assert pv.program_length(with_logo) == pytest.approx(
            pv.program_length(no_logo) + 3 - 0.6
        )


class TestGraph:
    def test_every_shot_is_normalised_before_joining(self):
        graph, _ = pv.build_filter_graph(_plan(), logo_input=None, music_input=None,
                                         narration_input=None)
        for i in range(3):
            chain = next(p for p in graph.split(";") if p.endswith(f"[s{i}]"))
            assert "setsar=1,format=yuv420p" in chain and chain.endswith(f"fps=30[s{i}]")
        # The first shot's transition is ignored: there is nothing before it.
        assert "xfade=transition=fade:duration=0.500:offset=2.500[j1]" in graph
        assert "xfade=transition=fadewhite:duration=0.400:offset=4.100[j2]" in graph

    def test_cut_is_a_concat_that_restates_the_rate(self):
        shots = [pv.Shot("a.mp4", "video", 2.0), pv.Shot("b.mp4", "video", 2.0, transition="cut"),
                 pv.Shot("c.mp4", "video", 2.0, transition="fade")]
        graph, _ = pv.build_filter_graph(_plan(shots=shots), logo_input=None, music_input=None,
                                         narration_input=None)
        assert "[s0][s1]concat=n=2:v=1:a=0,fps=30[j1]" in graph
        assert "[j1][s2]xfade=transition=fade:duration=0.500:offset=3.500[j2]" in graph

    def test_watermark_stops_before_the_outro(self):
        plan = _plan(brand=pv.Brand(logo_path="l.png", watermark="top_left", outro_seconds=2))
        graph, has_audio = pv.build_filter_graph(plan, logo_input=3, music_input=None,
                                                 narration_input=None)
        outro_start = pv.segment_starts(plan)[-1]
        assert f"enable='lt(t,{outro_start:.3f})'" in graph
        assert "[3:v]format=rgba,split[lw][lo]" in graph and not has_audio

    @pytest.mark.parametrize("corner,x,y", [
        ("bottom_center", "(W-w)/2", "H-h-"),
        ("top_center", "(W-w)/2", None),
        ("top_right", "W-w-", None),
    ])
    def test_watermark_can_sit_in_the_middle_of_an_edge(self, corner, x, y):
        plan = _plan(brand=pv.Brand(logo_path="l.png", watermark=corner))
        graph, _ = pv.build_filter_graph(plan, logo_input=3, music_input=None, narration_input=None)
        assert f"overlay={x}" in graph
        if y:
            assert f"overlay={x}:{y}" in graph

    def test_overlay_anchor_follows_its_shot_after_beat_snapping(self):
        plan = _plan()
        snapped = pv.PromoPlan(shots=[
            pv.Shot(**{**s.__dict__, "duration": d})
            for s, d in zip(plan.shots, pv.snap_to_beats(plan, 0.5, 0.0))
        ])
        for index in range(len(plan.shots)):
            assert pv.anchored_start(snapped, index, 0.25) == pytest.approx(
                pv.segment_starts(snapped)[index] + 0.25
            )
        with pytest.raises(ValueError):
            pv.anchored_start(plan, 3, 0.0)

    def test_music_is_trimmed_and_faded_to_the_program(self):
        plan = _plan(audio=pv.AudioPlan(music_path="m.wav"))
        graph, has_audio = pv.build_filter_graph(plan, logo_input=None, music_input=3,
                                                 narration_input=None)
        total = pv.program_length(plan)
        assert has_audio and f"atrim=duration={total:.3f}" in graph and "[aout]" in graph

    def test_cmd_keeps_inputs_local_and_loops_music(self):
        plan = _plan(audio=pv.AudioPlan(music_path="m.wav", music_start=1.5))
        cmd = pv.build_promo_cmd("ffmpeg", plan, "out.mp4")
        assert cmd[cmd.index("-protocol_whitelist") + 1] == "file,pipe"
        # Ignore the per-input protocol whitelist when reading the music input.
        args = [a for i, a in enumerate(cmd)
                if a != "-protocol_whitelist" and (i == 0 or cmd[i - 1] != "-protocol_whitelist")]
        music = args.index("m.wav")
        assert args[music - 5:music] == ["-ss", "1.500", "-stream_loop", "-1", "-i"]
        assert "lavfi" not in cmd

    @pytest.mark.parametrize("change", [
        {"shape": "round"}, {"fps": 24}, {"look": "sepia"},
        {"brand": pv.Brand(watermark="middle")},
    ])
    def test_rejects_unknown_options(self, change):
        with pytest.raises(ValueError):
            pv.validate_plan(_plan(**change))

    def test_rejects_too_long_programs(self):
        shots = [pv.Shot("a.mp4", "video", 60.0, transition="cut")] * 6
        with pytest.raises(ValueError):
            pv.validate_plan(_plan(shots=shots))


class TestOldFfmpeg:
    HELP = """Filter xfade
  transition        <int>        ..FV....... set cross fade transition (from -1 to 31) (default fade)
     custom          -1           ..FV....... custom transition
     fade            0            ..FV....... fade transition
     slideleft       5            ..FV....... slide left transition
     fadewhite       13           ..FV....... fadewhite transition
"""

    def test_parses_listed_transitions(self):
        assert pv.xfade_transitions(self.HELP) >= {"fade", "slideleft", "fadewhite"}
        assert pv.xfade_transitions("Unknown filter 'xfade'.") == set()

    def test_missing_transition_falls_back(self):
        available = pv.xfade_transitions(self.HELP)
        assert pv.usable_transition("slide", available) == "slide"
        assert pv.usable_transition("zoom", available) == "fade"
        assert pv.usable_transition("cut", set()) == "cut"
        assert pv.usable_transition("fade", set()) == "cut"


class TestBeats:
    @staticmethod
    def _clicks(bpm: float, offset: float, seconds: float = 20.0, rate: int = 22050):
        signal = np.zeros(int(seconds * rate), dtype=np.float32)
        rng = np.random.default_rng(0)
        period = 60.0 / bpm
        t = offset
        while t < seconds - 0.05:
            start = int(t * rate)
            signal[start:start + 400] += rng.normal(0, 0.6, 400).astype(np.float32)
            t += period
        return signal, rate

    def test_finds_tempo_and_phase(self):
        samples, rate = self._clicks(120, 0.21)
        period, phase = pv.detect_beats(samples, rate)
        assert period == pytest.approx(0.5, abs=0.03)
        assert phase == pytest.approx(0.21, abs=0.04)
        # numpy floats round differently; snapping must see plain floats.
        assert type(period) is float and type(phase) is float

    def test_silence_has_no_grid(self):
        assert pv.detect_beats(np.zeros(22050 * 5, dtype=np.float32), 22050) == (0.0, 0.0)

    def test_snapped_cuts_land_on_beats_whatever_the_transitions(self):
        """Regression: transitions clamped to 45 % of a shortened neighbour used
        to push cuts off the beat (29 of 40 random plans, by up to 0.37 s)."""
        import random

        rng = random.Random(7)
        names = list(pv.TRANSITIONS)
        for _ in range(200):
            shots = [
                pv.Shot("x", "video", round(rng.uniform(pv.MIN_SHOT_SECONDS, 4.0), 3),
                        transition=rng.choice(names),
                        transition_seconds=round(rng.uniform(0, 1.2), 2))
                for _ in range(rng.randint(2, 9))
            ]
            period = round(rng.uniform(0.25, 0.9), 4)
            plan = pv.PromoPlan(shots=shots)
            durations = pv.snap_to_beats(plan, period, 0.0)
            snapped = pv.PromoPlan(shots=[
                pv.Shot(**{**s.__dict__, "duration": d}) for s, d in zip(shots, durations)
            ])
            for start in pv.segment_starts(snapped)[1:]:
                assert abs(start / period - round(start / period)) * period < 0.003, (period, durations)
            # Snapping again (as /promo/render does for a timeline that already
            # snapped) leaves it alone.
            assert pv.snap_to_beats(snapped, period, 0.0) == durations

    def test_snapping_is_stable_on_cuts_already_on_the_grid(self):
        """The timeline draws the grid and snaps edits to it; a second snap at
        render time must leave such cuts where they are."""
        plan = _plan()
        once = pv.snap_to_beats(plan, 0.5, 0.0)
        snapped = pv.PromoPlan(shots=[
            pv.Shot(**{**s.__dict__, "duration": d}) for s, d in zip(plan.shots, once)
        ])
        assert pv.snap_to_beats(snapped, 0.5, 0.0) == once

    def test_snapped_cuts_land_on_beats(self):
        plan = _plan()
        durations = pv.snap_to_beats(plan, 0.5, 0.0)
        snapped = pv.PromoPlan(shots=[
            pv.Shot(**{**s.__dict__, "duration": d}) for s, d in zip(plan.shots, durations)
        ])
        for start in pv.segment_starts(snapped)[1:]:
            assert (start / 0.5) == pytest.approx(round(start / 0.5), abs=1e-6)
        assert durations[-1] == plan.shots[-1].duration


@pytest.fixture()
def client_and_outputs(tmp_path, monkeypatch):
    from core import config

    monkeypatch.setattr(config, "OUTPUTS_DIR", str(tmp_path))
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        yield client, tmp_path


class TestEditorFinalize:
    @pytest.mark.parametrize("media_id", ["../x.webm", "0123456789abcdef.webm", "nope"])
    def test_unknown_media_is_not_found(self, client_and_outputs, media_id):
        client, _ = client_and_outputs
        assert client.post("/editor/finalize", json={"media_id": media_id}).status_code == 404

    def test_turns_a_webm_export_into_an_mp4(self, client_and_outputs, tmp_path_factory):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg or not shutil.which("ffprobe"):
            pytest.skip("ffmpeg/ffprobe are not installed")
        client, outputs = client_and_outputs
        src = tmp_path_factory.mktemp("finalize") / "export.webm"
        made = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=1",
             "-f", "lavfi", "-i", "sine=f=440:d=1",
             "-c:v", "libvpx-vp9", "-c:a", "libopus", "-shortest", str(src)],
            capture_output=True,
        )
        if made.returncode != 0:
            pytest.skip("this ffmpeg cannot write VP9/Opus")
        with open(src, "rb") as fh:
            uploaded = client.post("/promo/media", files={"file": ("export.webm", fh)}).json()
        res = client.post("/editor/finalize", json={"media_id": uploaded["id"]})
        assert res.status_code == 200, res.text[:400]
        body = res.json()
        assert body["id"].endswith(".mp4") and body["has_audio"] is True
        assert (body["width"], body["height"]) == (320, 240)
        media_dir = outputs / "promo_media"
        assert (media_dir / body["id"]).is_file()
        # The intermediate WebM is not kept.
        assert not (media_dir / uploaded["id"]).exists()

    def test_refuses_audio(self, client_and_outputs, tmp_path_factory):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg or not shutil.which("ffprobe"):
            pytest.skip("ffmpeg/ffprobe are not installed")
        client, _ = client_and_outputs
        src = tmp_path_factory.mktemp("finalize_audio") / "a.wav"
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", "sine=f=220:d=1", str(src)], check=True)
        with open(src, "rb") as fh:
            uploaded = client.post("/promo/media", files={"file": ("a.wav", fh)}).json()
        assert client.post("/editor/finalize", json={"media_id": uploaded["id"]}).status_code == 422


class TestRoute:
    def test_refuses_non_media_uploads(self, client_and_outputs):
        client, outputs = client_and_outputs
        res = client.post("/promo/media", files={"file": ("x.json", b"{}", "application/json")})
        assert res.status_code == 415
        assert not list((outputs / "promo_media").glob("*")) if (outputs / "promo_media").exists() else True

    @pytest.mark.parametrize("media_id", ["../x.mp4", "0123456789abcdef.mp4", "abc.mp4"])
    def test_unknown_media_is_not_found(self, client_and_outputs, media_id):
        client, _ = client_and_outputs
        res = client.post("/promo/render", json={"shots": [{"media_id": media_id, "duration": 2}]})
        assert res.status_code == 404

    def test_overlays_anchored_to_shots_land_on_the_snapped_cuts(
        self, client_and_outputs, tmp_path_factory, monkeypatch
    ):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg or not shutil.which("ffprobe"):
            pytest.skip("ffmpeg/ffprobe are not installed")
        from api.routers import promo as promo_router

        client, _ = client_and_outputs
        src = tmp_path_factory.mktemp("anchor_src")

        def upload(name, *args):
            path = src / name
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],
                           check=True)
            with open(path, "rb") as fh:
                res = client.post("/promo/media", files={"file": (name, fh)})
            assert res.status_code == 200, res.text[:400]
            return res.json()["id"]

        still = upload("s.png", "-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1")
        badge = upload("b.png", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1")
        music = upload("m.wav", "-f", "lavfi", "-i", "sine=f=220:d=12")

        async def grid(_path, _start):
            return 0.6, 0.0

        captured = {}

        class Captured(Exception):
            pass

        def capture(_ffmpeg, plan, _out):
            captured["plan"] = plan
            raise Captured

        monkeypatch.setattr(promo_router, "_beat_grid", grid)
        monkeypatch.setattr(pv, "build_promo_cmd", capture)
        body = {
            "shots": [
                {"media_id": still, "duration": 2.0, "transition": "cut"},
                {"media_id": still, "duration": 2.3, "transition": "fade", "transition_seconds": 0.4},
                {"media_id": still, "duration": 1.7, "transition": "cut"},
            ],
            "music_id": music,
            "snap_to_beats": True,
            "overlays": [
                {"media_id": badge, "shot": 1, "start": 0.2, "duration": 1.0},
                {"media_id": badge, "shot": 2, "start": 0.0, "duration": 1.0},
                {"media_id": badge, "start": 1.0, "duration": 1.0},
            ],
        }
        with pytest.raises(Captured):
            client.post("/promo/render", json=body)
        plan = captured["plan"]
        starts = pv.segment_starts(plan)
        # Snapping moved the cuts off the requested lengths...
        assert [s.duration for s in plan.shots] != [2.0, 2.3, 1.7]
        # ...and anchored overlays moved with them; the absolute one did not.
        assert [o.start for o in plan.overlays] == [
            pytest.approx(starts[1] + 0.2), pytest.approx(starts[2]), 1.0,
        ]

        body["overlays"] = [{"media_id": badge, "shot": 3, "duration": 1.0}]
        body["snap_to_beats"] = False
        assert client.post("/promo/render", json=body).status_code == 422

    def test_beats_endpoint_finds_a_steady_tempo(self, client_and_outputs, tmp_path_factory):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg or not shutil.which("ffprobe"):
            pytest.skip("ffmpeg/ffprobe are not installed")
        client, _ = client_and_outputs
        path = tmp_path_factory.mktemp("beats") / "click.wav"
        # A click every 0.5 s (120 BPM).
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
            "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1000*t),0)':s=22050:d=12", str(path),
        ], check=True)
        with open(path, "rb") as fh:
            media = client.post("/promo/media", files={"file": ("click.wav", fh)}).json()
        res = client.get(f"/promo/beats/{media['id']}")
        assert res.status_code == 200, res.text
        assert res.json()["period"] == pytest.approx(0.5, abs=0.02)
        assert client.get(f"/promo/beats/{media['id']}", params={"start": -1}).status_code == 422
        assert client.get("/promo/beats/0123456789abcdef.wav").status_code == 404

    def test_renders_a_real_promo(self, client_and_outputs, tmp_path_factory):
        ffmpeg = shutil.which("ffmpeg")
        ffprobe = shutil.which("ffprobe")
        if not ffmpeg or not ffprobe:
            pytest.skip("ffmpeg/ffprobe are not installed")
        client, outputs = client_and_outputs
        src = tmp_path_factory.mktemp("promo_src")

        def make(name, *args):
            path = src / name
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args, str(path)],
                           check=True)
            return path

        clips = [
            make("a.mp4", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=3"),
            # Portrait, 60 fps, no audio stream, and shorter than its shot.
            make("b.mp4", "-f", "lavfi", "-i", "testsrc=s=720x1280:r=60:d=1.5"),
            make("c.png", "-f", "lavfi", "-i", "smptebars=s=800x600", "-frames:v", "1"),
        ]
        logo = make("logo.png", "-f", "lavfi", "-i",
                    "color=c=red:s=320x120,format=rgba,pad=400:200:40:40:color=black@0",
                    "-frames:v", "1")
        music = make("m.wav", "-f", "lavfi", "-i", "sine=f=220:d=4")

        def upload(path):
            with open(path, "rb") as fh:
                res = client.post("/promo/media", files={"file": (path.name, fh)})
            assert res.status_code == 200, res.text[:400]
            return res.json()

        ids = [upload(p) for p in clips]
        assert ids[0]["kind"] == "video" and ids[0]["duration"] == pytest.approx(3.0, abs=0.1)
        assert ids[2]["kind"] == "image" and ids[2]["duration"] is None
        logo_id, music_id = upload(logo)["id"], upload(music)["id"]

        res = client.post("/promo/render", json={
            "shape": "square", "fps": 30, "look": "vivid",
            "shots": [
                {"media_id": ids[0]["id"], "duration": 2.5, "start": 0.3},
                {"media_id": ids[1]["id"], "duration": 2.0, "fit": "contain",
                 "transition": "slide", "transition_seconds": 0.5},
                {"media_id": ids[2]["id"], "duration": 2.0, "motion": "zoom_in",
                 "transition": "cut"},
            ],
            "logo_id": logo_id, "watermark": "bottom_right", "outro_seconds": 1.5,
            "music_id": music_id,
        })
        assert res.status_code == 200, res.text[:1200]
        body = res.json()
        # 2.5 + 2.0 - 0.5 + 2.0 + 1.5 (outro) - 0.6 (outro fade)
        assert body["duration"] == pytest.approx(6.9)
        video = outputs / body["output"]
        probe = json.loads(subprocess.run(
            [ffprobe, "-v", "error", "-count_frames", "-show_entries",
             "stream=codec_type,width,height,r_frame_rate,nb_read_frames:format=duration",
             "-of", "json", str(video)],
            check=True, capture_output=True, text=True,
        ).stdout)
        kinds = {s["codec_type"]: s for s in probe["streams"]}
        assert (kinds["video"]["width"], kinds["video"]["height"]) == (1080, 1080)
        assert kinds["video"]["r_frame_rate"] == "30/1"
        assert int(kinds["video"]["nb_read_frames"]) == pytest.approx(round(6.9 * 30), abs=1)
        assert "audio" in kinds
        assert float(probe["format"]["duration"]) == pytest.approx(6.9, abs=0.1)

        # Narration only, a start past the clip's end, a silent "music" file.
        voice = upload(make("v.wav", "-f", "lavfi", "-i", "sine=f=500:d=1"))["id"]
        res = client.post("/promo/render", json={
            "shots": [{"media_id": ids[0]["id"], "duration": 2.0, "start": 99}],
            "narration_id": voice,
        })
        assert res.status_code == 200, res.text[:1200]
        narrated = outputs / res.json()["output"]
        probe = json.loads(subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "stream=codec_type:format=duration",
             "-of", "json", str(narrated)], check=True, capture_output=True, text=True,
        ).stdout)
        assert {s["codec_type"] for s in probe["streams"]} == {"video", "audio"}
        assert float(probe["format"]["duration"]) == pytest.approx(2.0, abs=0.1)
        res = client.post("/promo/render", json={
            "shots": [{"media_id": ids[0]["id"], "duration": 2.0}],
            "music_id": ids[1]["id"], "narration_id": voice,
        })
        assert res.status_code == 422


def test_alpha_overlay_shows_only_where_opaque_and_only_in_its_window(client_and_outputs, tmp_path_factory):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("ffmpeg is not installed")
    client, outputs = client_and_outputs
    src = tmp_path_factory.mktemp("overlay_src")
    base = src / "blue.mp4"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "color=c=blue:s=1080x1080:r=30:d=4", str(base)], check=True)
    # Left half opaque red, right half fully transparent, 1 s long.
    layer = src / "layer.webm"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "color=c=red:s=1080x1080:r=30:d=1,format=yuva420p,"
                    "geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,540),255,0)'",
                    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
                    str(layer)], check=True)

    def upload(path):
        with open(path, "rb") as fh:
            res = client.post("/promo/media", files={"file": (path.name, fh)})
        assert res.status_code == 200, res.text[:400]
        return res.json()["id"]

    res = client.post("/promo/render", json={
        "shape": "square",
        "shots": [{"media_id": upload(base), "duration": 3.0}],
        "overlays": [{"media_id": upload(layer), "start": 1.0}],
    })
    assert res.status_code == 200, res.text[:1200]
    video = outputs / res.json()["output"]

    def pixel(t, x):
        raw = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", str(video),
             "-frames:v", "1", "-vf", f"crop=1:1:{x}:540,format=rgb24", "-f", "rawvideo", "-"],
            check=True, capture_output=True,
        ).stdout
        return tuple(raw[:3])

    red, blue = pixel(1.5, 200), pixel(1.5, 900)
    assert red[0] > 180 and red[2] < 80, red          # opaque half covers the clip
    assert blue[2] > 180 and blue[0] < 80, blue       # transparent half shows it
    before = pixel(0.5, 200)
    after = pixel(2.5, 200)
    assert before[2] > 180 and after[2] > 180, (before, after)  # only inside 1–2 s
