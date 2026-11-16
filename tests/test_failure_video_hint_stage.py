"""Video-download hints belong to the stages that fetch the video.

A first-run transcribe that timed out while the aligner model downloaded was
answered with "The connection to the video server dropped mid-download",
because ``classify`` maps any "timed out" to ``VIDEO_DOWNLOAD_NETWORK``. The
download had worked; the hint sent the user to retry the wrong step.
"""

import pytest

from core.failure import build_failure

# The stages that fetch the source video (services/dub_pipeline.py).
VIDEO_SOURCE_STAGES = {"download", "ingest"}

_TRANSCRIBE_TIMEOUT = "Transcription timed out. Try a smaller model or set ASR to CPU."

_VIDEO_ONLY_MESSAGES = [
    _TRANSCRIBE_TIMEOUT,
    "Broken pipe",
    "This video is DRM protected",
    "Sign in to confirm you're not a bot. Use --cookies",
    "Unsupported URL: https://example.com",
]


@pytest.mark.parametrize("message", _VIDEO_ONLY_MESSAGES)
@pytest.mark.parametrize(
    "stage",
    ["transcribe", "transcribe-preflight", "model-load", "task", "batch", "extract"],
)
def test_video_source_hints_never_reach_other_stages(stage, message):
    failure = build_failure(message, stage=stage, include_diagnostic=False)
    assert not failure["docs_topic"].startswith(("VIDEO_", "UNSUPPORTED_VIDEO"))
    assert "video server" not in failure["hint"]
    assert "download" not in failure["hint"].lower()


@pytest.mark.parametrize("stage", sorted(VIDEO_SOURCE_STAGES))
def test_video_source_hints_still_reach_the_download(stage):
    failure = build_failure(_TRANSCRIBE_TIMEOUT, stage=stage, include_diagnostic=False)
    assert failure["docs_topic"] == "VIDEO_DOWNLOAD_NETWORK"
    assert "video server" in failure["hint"]
