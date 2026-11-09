"""Karaoke word-highlight caption burn-in (Export → Video → Hardsub → Karaoke).

Pure/unit tier — no GPU, no ffmpeg run:

  - ``services.karaoke_ass.build_ass``: header/style shape, ``\\k``/``\\kf``
    tag timing from persisted words, even-split fallback (old jobs and
    translated tracks whose persisted ASR words no longer spell the display
    text), escaping, and the dual-layout contract (unsupported → ValueError);
  - word persistence at transcribe time (``services.segmentation``): segments
    carry ``words`` [{text, start, end}], merges CONCATENATE word lists, the
    speaker re-split gives each piece only its own words;
  - ``scale_words`` linear mapping for Smart Fit fitted cues;
  - ``/dub/download?burn_subs=1&karaoke=1``: the mocked ffmpeg argv burns via
    the ``ass=`` filter AFTER the same graph position the SRT burn uses, the
    temp basename is plain ASCII, and the line path stays byte-identical when
    karaoke is off (or when dual forces the line layout).
"""
from __future__ import annotations

import os
import re
import uuid

import pytest

os.environ.setdefault("OMNIVOICE_MODEL", "test")

from services.karaoke_ass import (
    build_ass,
    estimate_word_times,
    scale_words,
    split_tokens,
)


# ---------------------------------------------------------------------------
# build_ass — script shape
# ---------------------------------------------------------------------------

def _cues():
    return [
        {"id": "a", "start": 0.0, "end": 2.0, "text": "Hello world",
         "words": [{"text": "Hello", "start": 0.0, "end": 0.8},
                   {"text": "world", "start": 1.0, "end": 2.0}]},
        {"id": "b", "start": 3.0, "end": 5.0, "text": "General Kenobi"},
    ]


class TestBuildAssShape:
    def test_header_has_one_default_style_and_play_res(self):
        script = build_ass(_cues())
        assert script.startswith("[Script Info]")
        assert "PlayResX: 1920" in script and "PlayResY: 1080" in script
        assert script.count("Style: Default,") == 1
        assert "[V4+ Styles]" in script and "[Events]" in script

    def test_custom_play_res(self):
        script = build_ass(_cues(), play_res=(1280, 720))
        assert "PlayResX: 1280" in script and "PlayResY: 720" in script

    def test_one_dialogue_per_cue_with_ass_times(self):
        script = build_ass(_cues())
        dialogues = [l for l in script.splitlines() if l.startswith("Dialogue:")]
        assert len(dialogues) == 2
        assert dialogues[0].startswith("Dialogue: 0,0:00:00.00,0:00:02.00,Default,")
        assert dialogues[1].startswith("Dialogue: 0,0:00:03.00,0:00:05.00,Default,")

    def test_empty_and_blank_cues_skipped(self):
        script = build_ass([{"start": 0, "end": 1, "text": "  "}, {"start": 1, "end": 2, "text": ""}])
        assert "Dialogue:" not in script

    def test_dual_layout_is_a_contract_violation(self):
        # Dual karaoke is out of scope — callers must keep the SRT line burn.
        with pytest.raises(ValueError):
            build_ass(_cues(), dual=True)


# ---------------------------------------------------------------------------
# build_ass — karaoke tag timing
# ---------------------------------------------------------------------------

class TestKaraokeTags:
    def test_persisted_words_drive_kf_durations(self):
        script = build_ass(_cues())
        line = next(l for l in script.splitlines() if "Hello" in l)
        # word "Hello": sweep until "world" starts (1.0 - 0.0 = 100 cs);
        # word "world": sweep to the cue end (2.0 - 1.0 = 100 cs).
        assert "{\\kf100}Hello {\\kf100}world" in line

    def test_lead_in_gap_gets_plain_k_tag(self):
        cue = {"start": 0.0, "end": 2.0, "text": "Hi there",
               "words": [{"text": "Hi", "start": 0.5, "end": 1.0},
                         {"text": "there", "start": 1.0, "end": 2.0}]}
        script = build_ass([cue])
        assert "{\\k50}{\\kf50}Hi {\\kf100}there" in script

    def test_estimated_split_fallback_without_words(self):
        # Weights are len+1: "General" 8, "Kenobi" 7 over 200 cs.
        script = build_ass([{"start": 3.0, "end": 5.0, "text": "General Kenobi"}])
        assert "{\\kf107}General {\\kf93}Kenobi" in script

    def test_translated_cue_falls_back_to_estimated_split(self):
        # Persisted ASR words are SOURCE-language tokens; after translation
        # they no longer spell the display text — display text must win.
        cue = {"start": 0.0, "end": 2.0, "text": "Hallo Welt",
               "words": [{"text": "Hello", "start": 0.0, "end": 0.5},
                         {"text": "world", "start": 0.5, "end": 2.0}]}
        script = build_ass([cue])
        assert "Hello" not in script
        assert "{\\kf109}Hallo {\\kf91}Welt" in script

    def test_malformed_words_fall_back_to_estimated_split(self):
        # "Hi" weighs 3, "there" 6 over 100 cs.
        cue = {"start": 0.0, "end": 1.0, "text": "Hi there",
               "words": [{"text": "Hi"}, {"text": "there", "start": "x", "end": None}]}
        script = build_ass([cue])
        assert "{\\kf33}Hi {\\kf67}there" in script

    def test_no_space_script_splits_per_character_without_spaces(self):
        # "Tokyo" in kanji + "2020" + "nen": the Latin digits stay one token,
        # each ideograph is its own token, and no space is inserted.
        text = "\u6771\u4eac2020\u5e74"
        script = build_ass([{"start": 0.0, "end": 1.0, "text": text}])
        line = next(l for l in script.splitlines() if l.startswith("Dialogue:"))
        assert line.count("\\kf") == 4
        assert re.sub(r"\{[^}]*\}", "", line.split(",,0,0,0,,", 1)[1]) == text

    def test_thai_marks_stay_with_their_base_character(self):
        # Thai "kin" (eat): base + vowel mark + final; the mark is combining.
        text = "\u0e01\u0e34\u0e19"
        tokens = [t for t, _ in split_tokens(text)]
        assert tokens == ["\u0e01\u0e34", "\u0e19"]

    def test_words_clamped_into_cue_span(self):
        cue = {"start": 1.0, "end": 2.0, "text": "Hi there",
               "words": [{"text": "Hi", "start": 0.0, "end": 0.5},
                         {"text": "there", "start": 9.0, "end": 9.5}]}
        script = build_ass([cue])
        line = next(l for l in script.splitlines() if l.startswith("Dialogue:"))
        # No karaoke duration may exceed the 1 s cue.
        assert all(int(cs) <= 100 for cs in re.findall(r"\\kf?(\d+)", line))

    def test_braces_and_newlines_escaped(self):
        cue = {"start": 0.0, "end": 1.0, "text": "{\\b1}bold\nnext"}
        script = build_ass([cue])
        assert "{\\b1}" not in script.split("[Events]")[1].replace("\\{", "")
        assert "\\{" in script and "\\}" in script
        line = next(l for l in script.splitlines() if l.startswith("Dialogue:"))
        assert "\n" not in line


class TestKaraokeStyles:
    def _events(self, script):
        out = []
        for line in script.splitlines():
            if line.startswith("Dialogue:"):
                _, start, end, rest = line.split(",", 3)
                out.append((start, end, rest.split(",,0,0,0,,", 1)[1]))
        return out

    def test_sweep_is_the_default_and_keeps_the_accent_fill(self):
        assert build_ass(_cues()) == build_ass(_cues(), style="sweep")
        assert "Style: Default,Inter Variable,64,&H0000E7FF," in build_ass(_cues())

    @pytest.mark.parametrize("style", ["highlight", "pop"])
    def test_word_styles_tile_the_cue_without_gaps_or_overlaps(self, style):
        cue = {"start": 0.0, "end": 2.0, "text": "Hi there friend",
               "words": [{"text": "Hi", "start": 0.333, "end": 0.6},
                         {"text": "there", "start": 0.667, "end": 1.2},
                         {"text": "friend", "start": 1.333, "end": 2.0}]}
        events = self._events(build_ass([cue], style=style))
        # Lead-in (no active word) + one event per word.
        assert len(events) == 4
        assert events[0][0] == "0:00:00.00" and events[-1][1] == "0:00:02.00"
        for (_, end, _), (start, _, _) in zip(events, events[1:]):
            assert end == start
        assert "\\1c" not in events[0][2]
        for i, word in enumerate(["Hi", "there", "friend"], start=1):
            text = events[i][2]
            assert re.sub(r"\{[^}]*\}", "", text) == "Hi there friend"
            assert re.search(r"\\1c&H00E7FF&[^}]*\}" + word + r"\{\\r\}", text)

    def test_word_styles_use_a_white_base_line(self):
        script = build_ass(_cues(), style="highlight")
        assert "Style: Default,Inter Variable,64,&H00FFFFFF," in script

    def test_pop_only_animates_height_never_width(self):
        script = build_ass(_cues(), style="pop")
        assert "\\fscy125" in script and "\\t(0,120,\\fscy100" in script
        assert "\\fscx" not in script and "\\fsp" not in script

    def test_zero_length_intervals_are_dropped(self):
        cue = {"start": 0.0, "end": 1.0, "text": "a b",
               "words": [{"text": "a", "start": 0.0, "end": 0.0},
                         {"text": "b", "start": 0.0, "end": 1.0}]}
        events = self._events(build_ass([cue], style="highlight"))
        assert len(events) == 1 and events[0][:2] == ("0:00:00.00", "0:00:01.00")

    def test_escaping_holds_in_word_styles(self):
        script = build_ass([{"start": 0.0, "end": 1.0, "text": "{\\b1}x"}], style="pop")
        body = script.split("[Events]")[1]
        assert "{\\b1}" not in body.replace("\\{", "")

    def test_unknown_style_raises(self):
        with pytest.raises(ValueError):
            build_ass(_cues(), style="wobble")


# ---------------------------------------------------------------------------
# Helpers — estimated split + Smart Fit word scaling
# ---------------------------------------------------------------------------

class TestWordHelpers:
    def test_equal_length_words_split_evenly(self):
        words = estimate_word_times("a b c d", 2.0, 4.0)
        assert [w["text"] for w in words] == ["a", "b", "c", "d"]
        assert [w["sep"] for w in words] == [" ", " ", " ", ""]
        assert words[0]["start"] == pytest.approx(2.0)
        assert words[1]["start"] == pytest.approx(2.5)
        assert words[-1]["end"] == pytest.approx(4.0)

    def test_longer_words_get_more_time(self):
        words = estimate_word_times("a extraordinary", 0.0, 1.0)
        assert words[1]["end"] - words[1]["start"] > 5 * (words[0]["end"] - words[0]["start"])
        assert words[-1]["end"] == pytest.approx(1.0)

    def test_estimated_split_empty_text(self):
        assert estimate_word_times("   ", 0.0, 1.0) == []

    def test_scale_words_linear(self):
        words = [{"text": "a", "start": 1.0, "end": 2.0},
                 {"text": "b", "start": 2.0, "end": 3.0}]
        out = scale_words(words, 1.0, 3.0, 1.0, 3.75)
        assert out[0] == {"text": "a", "start": 1.0, "end": 2.375}
        assert out[1] == {"text": "b", "start": 2.375, "end": 3.75}

    def test_scale_words_degenerate_span_returns_none(self):
        words = [{"text": "a", "start": 1.0, "end": 2.0}]
        assert scale_words(words, 1.0, 1.0, 0.0, 2.0) is None
        assert scale_words(words, 0.0, 2.0, 2.0, 2.0) is None


# ---------------------------------------------------------------------------
# Word persistence at transcribe time (services.segmentation)
# ---------------------------------------------------------------------------

class TestSegmentWordPersistence:
    def test_segment_transcript_persists_words(self):
        from services.segmentation import segment_transcript
        result = {"segments": [{
            "start": 0.0, "end": 2.4,
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "there", "start": 0.5, "end": 1.0},
                {"word": "General", "start": 1.0, "end": 1.7},
                {"word": "Kenobi.", "start": 1.7, "end": 2.4},
            ],
        }]}
        segs = segment_transcript(result, duration=2.4)
        assert len(segs) == 1
        seg = segs[0]
        assert seg["text"] == "Hello there General Kenobi."
        assert [w["text"] for w in seg["words"]] == ["Hello", "there", "General", "Kenobi."]
        assert seg["words"][0] == {"text": "Hello", "start": 0.0, "end": 0.5}
        # Joined word texts spell the display text — build_ass can use them.
        script = build_ass(segs)
        assert "{\\kf" in script and "Kenobi." in script

    def test_merge_concatenates_word_lists(self):
        from services.segmentation import clean_up_segments
        segs = [
            {"id": "a", "start": 0.0, "end": 1.0, "text": "Hi there",
             "speaker_id": "Speaker 1",
             "words": [{"text": "Hi", "start": 0.0, "end": 0.5},
                       {"text": "there", "start": 0.5, "end": 1.0}]},
            {"id": "b", "start": 1.1, "end": 2.6, "text": "my good friend",
             "speaker_id": "Speaker 1",
             "words": [{"text": "my", "start": 1.1, "end": 1.5},
                       {"text": "good", "start": 1.5, "end": 2.0},
                       {"text": "friend", "start": 2.0, "end": 2.6}]},
        ]
        out = clean_up_segments(segs)
        assert len(out) == 1
        merged = out[0]
        assert merged["text"] == "Hi there my good friend"
        assert [w["text"] for w in merged["words"]] == ["Hi", "there", "my", "good", "friend"]

    def test_merge_with_one_sided_words_never_duplicates(self):
        from services.segmentation import clean_up_segments
        segs = [
            {"id": "a", "start": 0.0, "end": 1.0, "text": "Hi there",
             "speaker_id": "Speaker 1",
             "words": [{"text": "Hi", "start": 0.0, "end": 0.5},
                       {"text": "there", "start": 0.5, "end": 1.0}]},
            {"id": "b", "start": 1.1, "end": 2.6, "text": "my good friend",
             "speaker_id": "Speaker 1"},
        ]
        out = clean_up_segments(segs)
        assert len(out) == 1
        assert [w["text"] for w in out[0]["words"]] == ["Hi", "there"]

    def test_resplit_pieces_carry_only_their_own_words(self):
        from services.segmentation import Word, resplit_segments_by_turns
        seg = {"id": "s1", "start": 0.0, "end": 4.0, "text": "hey you come here",
               "speaker_id": "Speaker 1",
               "words": [{"text": "hey", "start": 0.0, "end": 1.0},
                         {"text": "you", "start": 1.0, "end": 2.0},
                         {"text": "come", "start": 2.0, "end": 3.0},
                         {"text": "here", "start": 3.0, "end": 4.0}]}
        words = [Word(0.0, 1.0, "hey"), Word(1.0, 2.0, "you"),
                 Word(2.0, 3.0, "come"), Word(3.0, 4.0, "here")]
        turns = [{"start": 0.0, "end": 2.0, "speaker": "Speaker 1"},
                 {"start": 2.0, "end": 4.0, "speaker": "Speaker 2"}]
        out = resplit_segments_by_turns([seg], words, turns)
        assert len(out) == 2
        assert [w["text"] for w in out[0]["words"]] == ["hey", "you"]
        assert [w["text"] for w in out[1]["words"]] == ["come", "here"]


# ---------------------------------------------------------------------------
# Export endpoint — karaoke=1 burns via the ass filter (ffmpeg mocked)
# ---------------------------------------------------------------------------

@pytest.fixture()
def burn_env(tmp_path, monkeypatch):
    """A seeded plain (no-retime) dub job + mocked ffmpeg for /dub/download."""
    from api.routers import dub_export as dx
    from services.dub_pipeline import _dub_jobs

    monkeypatch.setattr(dx, "DUB_DIR", str(tmp_path))
    monkeypatch.setattr(dx, "find_ffmpeg", lambda: "ffmpeg")

    calls: list[list[str]] = []

    async def fake_run_ffmpeg(cmd, timeout=0.0, job_id=None):
        calls.append(list(cmd))
        # cmd ends [..., output_path, "-y"] — satisfy the size check.
        with open(cmd[-2], "wb") as f:
            f.write(b"x" * 16)
        return 0, b"", b""

    monkeypatch.setattr(dx, "run_ffmpeg", fake_run_ffmpeg)

    job_id = f"kar_{uuid.uuid4().hex[:8]}"
    job_dir = tmp_path / job_id
    job_dir.mkdir(parents=True)
    video = job_dir / "source.mp4"
    video.write_bytes(b"v" * 16)
    track = job_dir / "dubbed_de.wav"
    track.write_bytes(b"a" * 16)
    job = {
        "video_path": str(video),
        "duration": 4.0,
        "filename": "clip.mp4",
        "segments": [
            {"id": "a", "start": 0.0, "end": 2.0, "text": "Hello world",
             "speaker_id": "Speaker 1",
             "words": [{"text": "Hello", "start": 0.0, "end": 0.9},
                       {"text": "world", "start": 1.0, "end": 2.0}]},
            {"id": "b", "start": 2.0, "end": 4.0, "text": "General Kenobi",
             "text_original": "general kenobi", "speaker_id": "Speaker 1"},
        ],
        "dubbed_tracks": {
            "de": {"path": str(track), "language": "German", "language_code": "de"},
        },
    }
    _dub_jobs[job_id] = job

    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        yield client, job_id, job_dir, calls
    _dub_jobs.pop(job_id, None)


def _filter_graph(cmd: list) -> str:
    assert "-filter_complex" in cmd
    return cmd[cmd.index("-filter_complex") + 1]


class TestKaraokeBurnEndpoint:
    def test_karaoke_burn_uses_ass_filter_and_ascii_temp(self, burn_env):
        client, job_id, job_dir, calls = burn_env
        res = client.get(
            f"/dub/download/{job_id}",
            params={"default_track": "de", "include_tracks": "de",
                    "preserve_bg": 0, "burn_subs": 1, "karaoke": 1},
        )
        assert res.status_code == 200, res.text[:500]
        graph = _filter_graph(calls[-1])
        assert "[0:v]ass='" in graph and ".ass':fontsdir='" in graph and "[vsub]" in graph
        assert "subtitles=" not in graph
        # Windows job dirs are C:\...; doubled backslashes in the quoted
        # filter value are a path ffmpeg cannot open.
        assert "\\\\" not in graph
        ass_files = list((job_dir / "exports").glob("burn_subs_*.ass"))
        assert len(ass_files) == 1
        assert ass_files[0].name.isascii()
        content = ass_files[0].read_text(encoding="utf-8")
        # Persisted words drive segment a; segment b splits by length (old-job path).
        assert "{\\kf100}Hello {\\kf100}world" in content
        assert "{\\kf107}General {\\kf93}Kenobi" in content

    def test_line_burn_stays_srt_when_karaoke_off(self, burn_env):
        client, job_id, job_dir, calls = burn_env
        res = client.get(
            f"/dub/download/{job_id}",
            params={"default_track": "de", "include_tracks": "de",
                    "preserve_bg": 0, "burn_subs": 1},
        )
        assert res.status_code == 200, res.text[:500]
        graph = _filter_graph(calls[-1])
        assert "[0:v]subtitles='" in graph and ".srt':fontsdir='" in graph and "[vsub]" in graph
        assert "ass='" not in graph
        assert list((job_dir / "exports").glob("burn_subs_*.ass")) == []

    def test_dual_forces_line_burn_even_with_karaoke_flag(self, burn_env):
        client, job_id, job_dir, calls = burn_env
        res = client.get(
            f"/dub/download/{job_id}",
            params={"default_track": "de", "include_tracks": "de",
                    "preserve_bg": 0, "burn_subs": 1, "karaoke": 1, "dual": 1},
        )
        assert res.status_code == 200, res.text[:500]
        graph = _filter_graph(calls[-1])
        assert "subtitles='" in graph
        assert "ass='" not in graph

    def test_karaoke_style_reaches_the_burned_script(self, burn_env):
        client, job_id, job_dir, calls = burn_env
        res = client.get(
            f"/dub/download/{job_id}",
            params={"default_track": "de", "include_tracks": "de", "preserve_bg": 0,
                    "burn_subs": 1, "karaoke": 1, "karaoke_style": "pop"},
        )
        assert res.status_code == 200, res.text[:500]
        content = next((job_dir / "exports").glob("burn_subs_*.ass")).read_text(encoding="utf-8")
        assert "\\fscy125" in content and "\\kf" not in content

    def test_unknown_karaoke_style_is_rejected(self, burn_env):
        client, job_id, _, calls = burn_env
        res = client.get(
            f"/dub/download/{job_id}",
            params={"default_track": "de", "include_tracks": "de", "preserve_bg": 0,
                    "burn_subs": 1, "karaoke": 1, "karaoke_style": "wobble"},
        )
        assert res.status_code == 422
        assert calls == []

    def test_every_burn_uses_the_bundled_font(self, burn_env):
        # Line and karaoke burns both point libass at backend/assets/fonts and
        # the line burn names the bundled family, so no OS font is guessed.
        client, job_id, _, calls = burn_env
        for karaoke in (0, 1):
            res = client.get(
                f"/dub/download/{job_id}",
                params={"default_track": "de", "include_tracks": "de", "preserve_bg": 0,
                        "burn_subs": 1, "karaoke": karaoke},
            )
            assert res.status_code == 200, res.text[:500]
            graph = _filter_graph(calls[-1])
            assert ":fontsdir='" in graph and "assets/fonts'" in graph
        assert "force_style='FontName=Inter Variable'" in _filter_graph(calls[0])

    def test_ass_sidecar_endpoint(self, burn_env):
        client, job_id, _, _ = burn_env
        res = client.get(f"/dub/ass/{job_id}", params={"lang": "de"})
        assert res.status_code == 200
        assert res.text.startswith("[Script Info]")
        assert "{\\kf" in res.text
        disposition = res.headers.get("content-disposition", "")
        assert disposition.startswith("attachment;") and ".ass" in disposition
