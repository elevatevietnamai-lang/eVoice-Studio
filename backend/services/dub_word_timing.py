"""Per-word timing for dubbed (translated) tracks, measured from the TTS audio.

Karaoke burn-in highlights each word as it is spoken. Source-language tracks
carry the ASR words of the transcription, but a translated track's speech is
the TTS output, whose words the transcription never saw. This module turns
one word-timestamped ASR pass over the finished dub track into per-segment
words that spell the track's display text exactly, so the karaoke builder
accepts them in place of its estimated split.

Storage (backward compatible; absent on older jobs, which keep the estimate)::

    job["dubbed_tracks"][lang]["words"] = {
        "version": 1,
        "segments": {seg_key: {"start": s, "end": e, "words": [{text, start, end}]}},
    }

``seg_key`` is the segment id (str), or the list index (str) for segments
without one, like ``segments_i18n``. Each entry's words live on the span
``[start, end]`` recorded with them (the segment's original timeline at
measure time) and are linearly re-scaled onto whatever span the export uses
(``scale_words``), so Smart Fit's fitted overlay and later timing edits both
carry them along. Every generate replaces ``dubbed_tracks[lang]`` wholesale,
so new audio never keeps the old words; edited text no longer spells the
words, which the karaoke builder then rejects.
"""
from __future__ import annotations

import difflib
import inspect
import logging
import re
from collections.abc import Sequence

from services.karaoke_ass import scale_words

logger = logging.getLogger(__name__)

WORDS_VERSION = 1

_WS = re.compile(r"\s+")
_NON_WORD = re.compile(r"[\W_]+", re.UNICODE)
# Scripts written without spaces between words: a whitespace token there is a
# whole clause, so measured timing per token would add nothing over the
# karaoke builder's own per-character estimate. Those tracks keep the estimate.
_NO_SPACE_SCRIPT = re.compile(
    "[฀-๿຀-໿က-႟ក-៿"
    "぀-ヿ㐀-䶿一-鿿豈-﫿]"
)


def _key(seg: dict, index: int) -> str:
    return str(seg.get("id")) if seg.get("id") is not None else str(index)


def _norm_token(token: str) -> str:
    return _NON_WORD.sub("", token.casefold())


def recognized_words(result: dict) -> list[tuple[str, float, float]]:
    """``(text, start, end)`` for every ASR word with real timestamps.

    Words without numeric times (whisperx leaves unalignable tokens bare) are
    skipped rather than given invented times.
    """
    out: list[tuple[str, float, float]] = []
    for seg in (result or {}).get("segments") or []:
        for w in (seg or {}).get("words") or []:
            if not isinstance(w, dict):
                continue
            text = str(w.get("word") or w.get("text") or "").strip()
            try:
                ws = float(w["start"])
                we = float(w["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if text and we >= ws:
                out.append((text, ws, we))
    out.sort(key=lambda t: t[1])
    return out


def _spread(tokens: Sequence[str], lo: float, hi: float) -> list[tuple[float, float]]:
    """Split [lo, hi] across tokens by character length (+1 per token)."""
    weights = [len(t) + 1 for t in tokens]
    total = float(sum(weights)) or 1.0
    span = max(0.0, hi - lo)
    out, acc = [], 0
    for w in weights:
        t0 = lo + span * acc / total
        acc += w
        out.append((t0, lo + span * acc / total))
    return out


def align_display_words(
    text: str,
    recognized: Sequence[tuple[str, float, float]],
    start: float,
    end: float,
) -> list[dict] | None:
    """Time each whitespace token of ``text`` from the recognized words.

    Tokens keep their display spelling; only their times come from the ASR.
    Matched tokens take the recognized word's times; a run the ASR heard
    differently (a number TTS spoke as words, a misrecognition) shares the
    recognized run's span; tokens the ASR missed fill the gap between their
    neighbours. Times are clamped into ``[start, end]`` and kept monotonic.
    Returns ``None`` when nothing usable was recognized, or for scripts
    written without spaces (the estimate stays).
    """
    tokens = [t for t in _WS.split(str(text or "").strip()) if t]
    if not tokens or not recognized or _NO_SPACE_SCRIPT.search(text or ""):
        return None
    start, end = float(start), float(end)
    if end <= start:
        return None
    rec = list(recognized)
    times: list[tuple[float, float] | None] = [None] * len(tokens)
    matcher = difflib.SequenceMatcher(
        None, [_norm_token(t) for t in tokens], [_norm_token(r[0]) for r in rec],
        autojunk=False,
    )
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (rec[j1 + k][1], rec[j1 + k][2])
        elif op == "replace":
            for k, span in enumerate(_spread(tokens[i1:i2], rec[j1][1], rec[j2 - 1][2])):
                times[i1 + k] = span
    # Tokens the ASR missed: spread them over the gap between the neighbours.
    i = 0
    while i < len(tokens):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(tokens) and times[j] is None:
            j += 1
        lo = times[i - 1][1] if i > 0 else start
        hi = times[j][0] if j < len(tokens) else end
        for k, span in enumerate(_spread(tokens[i:j], lo, max(lo, hi))):
            times[i + k] = span
        i = j
    out: list[dict] = []
    prev = start
    for tok, (ws, we) in zip(tokens, times):
        ws = min(max(float(ws), prev), end)
        we = min(max(float(we), ws), end)
        out.append({"text": tok, "start": round(ws, 3), "end": round(we, 3)})
        prev = ws
    return out


def track_cue_windows(job: dict, lang: str, segments: Sequence[dict]) -> list[tuple[float, float]]:
    """Each segment's ``(start, end)`` on the dub track's own timeline.

    Smart Fit and stretch_video move speech onto a fitted timeline; every
    other strategy keeps the source timeline.
    """
    track = (job.get("dubbed_tracks") or {}).get(lang) or {}
    strategy = track.get("timing_strategy")
    base = [(float(s.get("start", 0.0)), float(s.get("end", 0.0))) for s in segments]
    if strategy == "smart_fit":
        fitted = ((job.get("fit_plans") or {}).get(lang) or {}).get("fitted_segments") or []
        by_id = {str(f["id"]): f for f in fitted if f.get("id") is not None}
        out = []
        for i, seg in enumerate(segments):
            f = by_id.get(str(seg.get("id"))) if seg.get("id") is not None else None
            if f is None and not by_id and i < len(fitted):
                f = fitted[i]
            out.append((float(f["start"]), float(f["end"])) if f else base[i])
        return out
    if strategy == "stretch_video":
        entry = (job.get("video_stretch_plans") or {}).get(lang) or {}
        if entry.get("plan"):
            from services.fitted_subtitles import fitted_cues
            return fitted_cues(list(segments), entry["plan"])
    return base


def measure_segment_words(
    segments: Sequence[dict],
    windows: Sequence[tuple[float, float]],
    recognized: Sequence[tuple[str, float, float]],
) -> dict:
    """Per-segment words on each segment's ORIGINAL timeline.

    Each recognized word goes to the cue whose track window holds its
    midpoint, with each window reaching to the next cue's start so speech
    that overflows its slot still counts for its own line. The aligned words
    are then mapped from the track window back onto the segment's own
    ``[start, end]`` (identity outside Smart Fit / stretch_video), the same
    timeline the source ASR words use, so ``_apply_fitted_times`` scales
    both kinds identically.
    """
    buckets: list[list[tuple[str, float, float]]] = [[] for _ in segments]
    order = sorted(range(len(segments)), key=lambda k: windows[k][0])
    starts = [windows[k][0] for k in order]
    for word in recognized:
        mid = (word[1] + word[2]) / 2.0
        pos = 0
        while pos + 1 < len(starts) and starts[pos + 1] <= mid:
            pos += 1
        if order:
            buckets[order[pos]].append(word)
    out: dict = {}
    for i, seg in enumerate(segments):
        ws, we = windows[i]
        words = align_display_words(str(seg.get("text") or ""), buckets[i], ws, we)
        if not words:
            continue
        s0, s1 = float(seg.get("start", 0.0)), float(seg.get("end", 0.0))
        mapped = scale_words(words, ws, we, s0, s1)
        if mapped:
            out[_key(seg, i)] = {"start": s0, "end": s1, "words": mapped}
    return out


def track_words_for(job: dict, lang: str | None) -> dict | None:
    """The persisted per-segment words of ``lang``'s track, or ``None``."""
    if not lang:
        return None
    track = (job.get("dubbed_tracks") or {}).get(lang)
    entry = track.get("words") if isinstance(track, dict) else None
    if not isinstance(entry, dict) or entry.get("version") != WORDS_VERSION:
        return None
    segs = entry.get("segments")
    return segs if isinstance(segs, dict) else None


def overlay_track_words(rows: list[dict], track_words: dict) -> list[dict]:
    """Copy rows with each measured segment's words scaled onto its current span."""
    out = []
    for i, row in enumerate(rows):
        entry = track_words.get(_key(row, i))
        if isinstance(entry, dict) and isinstance(entry.get("words"), list):
            try:
                scaled = scale_words(
                    entry["words"], float(entry["start"]), float(entry["end"]),
                    float(row.get("start", 0.0)), float(row.get("end", 0.0)),
                )
            except (KeyError, TypeError, ValueError):
                scaled = None
            if scaled:
                row = dict(row, words=scaled)
        out.append(row)
    return out


def _asr_language(track: dict) -> str | None:
    code = str(track.get("language_code") or "").split("-")[0].split("_")[0].lower()
    return code if re.fullmatch(r"[a-z]{2,3}", code) else None


async def ensure_track_words(job_id: str, job: dict, lang: str | None, segments: Sequence[dict]) -> bool:
    """Measure and persist ``lang``'s per-word timing once, if missing.

    Runs one word-timestamped ASR pass over the dub track under
    ``gpu_exclusive.dub_job()``. Never fatal: a missing ASR model, a busy
    GPU, a timeout or any ASR failure logs and returns ``False``, and the
    karaoke export keeps the estimated split. Returns ``True`` when the
    track has measured words afterwards.
    """
    if not lang or not segments:
        return False
    track = (job.get("dubbed_tracks") or {}).get(lang)
    if not isinstance(track, dict) or not track.get("path"):
        return False
    if track_words_for(job, lang) is not None:
        return True
    import asyncio

    from services import gpu_exclusive
    from services.asr_backend import asr_model_missing_error

    if await asyncio.to_thread(asr_model_missing_error) is not None:
        logger.info("karaoke word timing skipped: no ASR model installed")
        return False
    audio_path = str(track["path"])
    language = _asr_language(track)

    def _recognize():
        from services.asr_backend import load_active_asr_backend
        backend = load_active_asr_backend()
        try:
            kwargs = {"word_timestamps": True}
            try:
                if language and "language" in inspect.signature(backend.transcribe).parameters:
                    kwargs["language"] = language
            except (TypeError, ValueError):
                pass
            return backend.transcribe(audio_path, **kwargs)
        finally:
            try:
                backend.unload()
            except Exception:
                logger.debug("ASR unload after word timing failed", exc_info=True)

    try:
        from services.asr_backend import run_transcribe_guarded
        from services.model_manager import _get_gpu_pool
        async with gpu_exclusive.dub_job():
            result = await run_transcribe_guarded(_get_gpu_pool(), _recognize, what="karaoke word timing")
    except Exception as exc:
        logger.warning("karaoke word timing skipped (%s); using estimated word times", type(exc).__name__)
        return False

    windows = track_cue_windows(job, lang, segments)
    measured = measure_segment_words(segments, windows, recognized_words(result))
    # Persist only onto the same track: a generate that published while the
    # ASR ran replaced the track, and these words describe the old audio.
    from services.dub_pipeline import get_job, save_job
    if get_job(job_id) is not job or (job.get("dubbed_tracks") or {}).get(lang) is not track:
        return False
    track["words"] = {"version": WORDS_VERSION, "segments": measured}
    try:
        save_job(job_id, job)
    except Exception:
        logger.warning("could not persist karaoke word timing", exc_info=True)
    return bool(measured)
