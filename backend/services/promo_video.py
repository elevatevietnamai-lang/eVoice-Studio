"""Promo video assembly: short clips and stills cut together with transitions,
a music bed, optional narration, a logo watermark and a logo outro, in one
ffmpeg pass.

Pure builders, like ``services.audiogram``: no ffmpeg run and no filesystem
access beyond the paths the caller passes in. The caller resolves media ids to
local paths; every input goes through ``local_inputs_only``. Generated layers
(the outro background) are ``color`` sources inside ``-filter_complex``, so no
``lavfi`` input is needed.

Every shot is normalised to the same size, frame rate, pixel format, SAR and
timebase before ``xfade``: ``xfade`` refuses inputs that differ in any of
them. Shots are joined one at a time, so each boundary can be a hard cut
(``concat``) or any ``xfade`` transition.

Timeline: with ``len`` the joined length so far, a transition of ``d`` seconds
into the next shot starts at ``offset = len - d`` and the new length is
``len + duration - d``. ``program_length`` and the builder share that rule.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Optional, Sequence

from services.ffmpeg_utils import bed_mix_filter, local_inputs_only

PromoShape = Literal["vertical", "square", "landscape"]
SHAPES: dict[str, tuple[int, int]] = {
    "vertical": (1080, 1920),
    "square": (1080, 1080),
    "landscape": (1920, 1080),
}
FPS_CHOICES = (30, 60)

#: User-facing transition names → ffmpeg ``xfade`` transitions (``None`` = cut).
TRANSITIONS: dict[str, Optional[str]] = {
    "cut": None,
    "fade": "fade",
    "flash": "fadewhite",
    "dip": "fadeblack",
    "slide": "slideleft",
    "push": "smoothleft",
    "wipe": "wipeleft",
    "zoom": "zoomin",
    "circle": "circleopen",
    "blur": "hblur",
}
#: Colour looks applied to every shot so clips from different sources match.
LOOKS: dict[str, str] = {
    "none": "",
    "warm": "colorbalance=rs=0.06:gs=0.02:bs=-0.06,eq=saturation=1.08",
    "cool": "colorbalance=rs=-0.05:gs=0.0:bs=0.07,eq=saturation=1.02",
    "vivid": "eq=contrast=1.08:saturation=1.25",
    "mono": "hue=s=0,eq=contrast=1.1",
}
FITS = ("cover", "contain")
MOTIONS = ("none", "zoom_in", "zoom_out")
CORNERS = ("none", "top_left", "top_right", "bottom_left", "bottom_right")

MAX_SHOTS = 40
MIN_SHOT_SECONDS = 0.5
MAX_SHOT_SECONDS = 60.0
MAX_PROGRAM_SECONDS = 300.0
MAX_TRANSITION_SECONDS = 2.0
#: A transition may use at most this share of either neighbouring shot.
TRANSITION_SHARE = 0.45
MAX_OUTRO_SECONDS = 10.0
#: Images are zoomed by at most this factor over the shot.
KEN_BURNS_ZOOM = 0.12


@dataclass(frozen=True)
class Shot:
    path: str
    kind: Literal["video", "image"]
    duration: float
    start: float = 0.0
    fit: str = "cover"
    motion: str = "none"
    #: Transition from the previous shot into this one (ignored on the first).
    transition: str = "fade"
    transition_seconds: float = 0.5


@dataclass(frozen=True)
class Brand:
    logo_path: Optional[str] = None
    watermark: str = "none"
    watermark_opacity: float = 0.8
    outro_seconds: float = 0.0
    outro_color: str = "0x0b0b0b"


@dataclass(frozen=True)
class AudioPlan:
    music_path: Optional[str] = None
    music_start: float = 0.0
    music_volume: float = 0.8
    fade_in: float = 0.5
    fade_out: float = 1.5
    narration_path: Optional[str] = None


@dataclass(frozen=True)
class PromoPlan:
    shots: Sequence[Shot]
    shape: str = "vertical"
    fps: int = 30
    look: str = "none"
    brand: Brand = field(default_factory=Brand)
    audio: AudioPlan = field(default_factory=AudioPlan)


def clamp_transition(seconds: float, before: float, after: float) -> float:
    """A transition never longer than ``TRANSITION_SHARE`` of either shot."""
    limit = min(MAX_TRANSITION_SECONDS, TRANSITION_SHARE * min(before, after))
    return round(max(0.0, min(float(seconds), limit)), 3)


def _segments(plan: PromoPlan) -> list[tuple[float, Optional[str], float]]:
    """``(duration, xfade name or None, transition seconds)`` per segment,
    the logo outro included as the last segment."""
    shots = list(plan.shots)
    durations = [s.duration for s in shots]
    names = [TRANSITIONS[s.transition] for s in shots]
    wanted = [s.transition_seconds for s in shots]
    if outro_seconds(plan) > 0:
        durations.append(outro_seconds(plan))
        names.append("fade")
        wanted.append(0.6)
    out: list[tuple[float, Optional[str], float]] = []
    for i, duration in enumerate(durations):
        if i == 0 or names[i] is None:
            out.append((duration, None, 0.0))
            continue
        out.append((duration, names[i], clamp_transition(wanted[i], durations[i - 1], duration)))
    return out


def outro_seconds(plan: PromoPlan) -> float:
    if not plan.brand.logo_path:
        return 0.0
    return round(min(MAX_OUTRO_SECONDS, max(0.0, plan.brand.outro_seconds)), 3)


def program_length(plan: PromoPlan) -> float:
    """Length of the finished video in seconds."""
    total = 0.0
    for i, (duration, _name, overlap) in enumerate(_segments(plan)):
        total = duration if i == 0 else total + duration - overlap
    return round(total, 3)


def segment_starts(plan: PromoPlan) -> list[float]:
    """Time each segment starts to appear in the finished video."""
    starts: list[float] = []
    length = 0.0
    for i, (duration, _name, overlap) in enumerate(_segments(plan)):
        if i == 0:
            starts.append(0.0)
            length = duration
        else:
            starts.append(round(length - overlap, 3))
            length += duration - overlap
    return starts


def validate_plan(plan: PromoPlan) -> None:
    """Raise ``ValueError`` with a user-facing reason for an unusable plan."""
    if not plan.shots:
        raise ValueError("Add at least one clip or image")
    if len(plan.shots) > MAX_SHOTS:
        raise ValueError(f"A promo video can hold at most {MAX_SHOTS} shots")
    if plan.shape not in SHAPES:
        raise ValueError(f"Unknown shape: {plan.shape}")
    if plan.fps not in FPS_CHOICES:
        raise ValueError(f"Frame rate must be one of {FPS_CHOICES}")
    if plan.look not in LOOKS:
        raise ValueError(f"Unknown look: {plan.look}")
    if plan.brand.watermark not in CORNERS:
        raise ValueError(f"Unknown watermark corner: {plan.brand.watermark}")
    for shot in plan.shots:
        if shot.kind not in ("video", "image"):
            raise ValueError(f"Unknown shot kind: {shot.kind}")
        if not MIN_SHOT_SECONDS <= shot.duration <= MAX_SHOT_SECONDS:
            raise ValueError(
                f"Each shot must last {MIN_SHOT_SECONDS:g}–{MAX_SHOT_SECONDS:g} s"
            )
        if shot.start < 0:
            raise ValueError("A clip cannot start before 0 s")
        if shot.transition not in TRANSITIONS:
            raise ValueError(f"Unknown transition: {shot.transition}")
        if shot.fit not in FITS:
            raise ValueError(f"Unknown fit: {shot.fit}")
        if shot.motion not in MOTIONS:
            raise ValueError(f"Unknown motion: {shot.motion}")
    if program_length(plan) > MAX_PROGRAM_SECONDS:
        raise ValueError(f"The video may last at most {MAX_PROGRAM_SECONDS:g} s")


def _color(value: str) -> str:
    """``#RRGGBB`` / ``0xRRGGBB`` → ``0xRRGGBB``; anything else → near black."""
    text = (value or "").strip().lower().removeprefix("#").removeprefix("0x")
    if len(text) == 6 and all(c in "0123456789abcdef" for c in text):
        return "0x" + text
    return "0x0b0b0b"


def _normalise(width: int, height: int, fps: int, duration: float, look: str) -> str:
    """Shared tail: grade, pixel format, exact length, then ``fps``.

    ``fps`` last: it fixes both the frame rate and the timebase (1/fps) that
    ``xfade`` requires to match. ``trim``/``tpad`` and an overlay with a
    still image (the outro logo) otherwise leave the rate unknown (1/0).
    """
    grade = LOOKS[look]
    return (
        (f"{grade}," if grade else "")
        + "setsar=1,format=yuv420p,"
        f"tpad=stop_mode=clone:stop_duration={duration:.3f},"
        f"trim=duration={duration:.3f},setpts=PTS-STARTPTS,fps={fps}"
    )


def _shot_chain(i: int, shot: Shot, width: int, height: int, fps: int, look: str) -> list[str]:
    src = f"[{i}:v]"
    out = f"[s{i}]"
    tail = _normalise(width, height, fps, shot.duration, look)
    cover = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    )
    if shot.kind == "image" and shot.motion != "none":
        frames = max(1, round(shot.duration * fps))
        if shot.motion == "zoom_in":
            zoom = f"1+{KEN_BURNS_ZOOM}*on/{frames}"
        else:
            zoom = f"{1 + KEN_BURNS_ZOOM}-{KEN_BURNS_ZOOM}*on/{frames}"
        # Upscale first so the zoom moves in sub-pixel steps without jitter.
        return [
            f"{src}scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,"
            f"crop={width * 2}:{height * 2},"
            f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:"
            f"s={width}x{height}:fps={fps},{tail}{out}"
        ]
    if shot.fit == "contain":
        return [
            f"{src}fps={fps},split[a{i}][b{i}]",
            f"[a{i}]{cover},boxblur=30:2,eq=brightness=-0.12[bg{i}]",
            f"[b{i}]scale={width}:{height}:force_original_aspect_ratio=decrease[fg{i}]",
            f"[bg{i}][fg{i}]overlay=(W-w)/2:(H-h)/2,{tail}{out}",
        ]
    return [f"{src}fps={fps},{cover},{tail}{out}"]


def _outro_chain(
    label: str, logo: str, width: int, height: int, fps: int, plan: PromoPlan
) -> list[str]:
    seconds = outro_seconds(plan)
    size = round(min(width, height) * 0.5)
    return [
        f"color=c={_color(plan.brand.outro_color)}:s={width}x{height}:r={fps}:d={seconds:.3f},"
        f"format=yuv420p[obg]",
        f"{logo}scale={size}:{size}:force_original_aspect_ratio=decrease,split[ol1][ol2]",
        # A soft glow under the logo: a blurred copy at reduced opacity.
        f"[ol2]gblur=sigma=28,colorchannelmixer=aa=0.65[oglow]",
        "[obg][oglow]overlay=(W-w)/2:(H-h)/2[og]",
        "[og][ol1]overlay=(W-w)/2:(H-h)/2,"
        f"fade=t=in:st=0:d={min(0.8, seconds / 2):.3f},"
        f"{_normalise(width, height, fps, seconds, 'none')}{label}",
    ]


def _watermark_xy(corner: str, margin: int) -> tuple[str, str]:
    x = f"{margin}" if corner.endswith("left") else f"W-w-{margin}"
    y = f"{margin}" if corner.startswith("top") else f"H-h-{margin}"
    return x, y


def build_filter_graph(plan: PromoPlan, *, logo_input: Optional[int], music_input: Optional[int],
                       narration_input: Optional[int]) -> tuple[str, bool]:
    """The ``-filter_complex`` graph → ``[vout]`` (and ``[aout]`` when audio).

    Inputs ``0..n-1`` are the shots in order; the logo, music and narration
    inputs follow at the indices given. Returns ``(graph, has_audio)``.
    """
    width, height = SHAPES[plan.shape]
    fps = plan.fps
    parts: list[str] = []
    for i, shot in enumerate(plan.shots):
        parts += _shot_chain(i, shot, width, height, fps, plan.look)

    labels = [f"[s{i}]" for i in range(len(plan.shots))]
    watermark = plan.brand.watermark != "none" and logo_input is not None
    outro = outro_seconds(plan) > 0 and logo_input is not None
    if logo_input is not None and (watermark or outro):
        if watermark and outro:
            parts.append(f"[{logo_input}:v]format=rgba,split[lw][lo]")
            logo_w, logo_o = "[lw]", "[lo]"
        else:
            parts.append(f"[{logo_input}:v]format=rgba[lg]")
            logo_w = logo_o = "[lg]"
        if outro:
            parts += _outro_chain("[sout]", logo_o, width, height, fps, plan)
            labels.append("[sout]")

    segments = _segments(plan)
    current = labels[0]
    length = segments[0][0]
    for i in range(1, len(labels)):
        duration, name, overlap = segments[i]
        joined = f"[j{i}]"
        if name is None:
            # concat drops the stream's frame rate (1/0), which a following
            # xfade refuses; state it again.
            parts.append(
                f"{current}{labels[i]}concat=n=2:v=1:a=0,fps={fps}{joined}"
            )
            length += duration
        else:
            parts.append(
                f"{current}{labels[i]}xfade=transition={name}:duration={overlap:.3f}:"
                f"offset={length - overlap:.3f}{joined}"
            )
            length += duration - overlap
        current = joined

    if watermark:
        margin = round(min(width, height) * 0.04)
        x, y = _watermark_xy(plan.brand.watermark, margin)
        alpha = max(0.1, min(1.0, plan.brand.watermark_opacity))
        parts.append(
            f"{logo_w}scale={round(min(width, height) * 0.16)}:-1,"
            f"colorchannelmixer=aa={alpha:.2f}[wm]"
        )
        # Not over the outro, where the logo is already the whole frame.
        main_end = segment_starts(plan)[-1] if outro else program_length(plan) + 1
        parts.append(f"{current}[wm]overlay={x}:{y}:enable='lt(t,{main_end:.3f})'[wmd]")
        current = "[wmd]"
    parts.append(f"{current}format=yuv420p[vout]")

    total = program_length(plan)
    audio = plan.audio
    has_audio = music_input is not None or narration_input is not None
    if music_input is not None:
        fade_in = max(0.0, min(audio.fade_in, total / 2))
        fade_out = max(0.0, min(audio.fade_out, total / 2))
        music_label = "mus" if narration_input is not None else "aout"
        parts.append(
            f"[{music_input}:a]atrim=duration={total:.3f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade_in:.3f},"
            f"afade=t=out:st={max(0.0, total - fade_out):.3f}:d={fade_out:.3f},"
            f"volume={max(0.0, min(2.0, audio.music_volume)):.3f}[{music_label}]"
        )
        if narration_input is not None:
            parts.append(
                bed_mix_filter(
                    "mus", f"{narration_input}:a", out="aout", duration="first",
                    tail=f",atrim=duration={total:.3f}",
                )
            )
    elif narration_input is not None:
        parts.append(f"[{narration_input}:a]apad,atrim=duration={total:.3f}[aout]")
    return ";".join(parts), has_audio


def build_promo_cmd(ffmpeg: str, plan: PromoPlan, out_path: str) -> list[str]:
    """Pure argv rendering ``plan`` to an H.264/AAC MP4 at ``out_path``."""
    validate_plan(plan)
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    for shot in plan.shots:
        if shot.kind == "image":
            cmd += ["-loop", "1", "-framerate", str(plan.fps),
                    "-t", f"{shot.duration:.3f}", "-i", str(shot.path)]
        else:
            # A little extra so a clip shorter than the shot still has frames
            # for ``tpad`` to hold; ``trim`` cuts it back exactly.
            cmd += ["-ss", f"{shot.start:.3f}", "-t", f"{shot.duration + 0.5:.3f}",
                    "-i", str(shot.path)]
    next_input = len(plan.shots)
    logo_input = music_input = narration_input = None
    wants_logo = plan.brand.logo_path and (
        plan.brand.watermark != "none" or outro_seconds(plan) > 0
    )
    if wants_logo:
        cmd += ["-i", str(plan.brand.logo_path)]
        logo_input, next_input = next_input, next_input + 1
    if plan.audio.music_path:
        cmd += ["-ss", f"{max(0.0, plan.audio.music_start):.3f}",
                "-stream_loop", "-1", "-i", str(plan.audio.music_path)]
        music_input, next_input = next_input, next_input + 1
    if plan.audio.narration_path:
        cmd += ["-i", str(plan.audio.narration_path)]
        narration_input, next_input = next_input, next_input + 1

    graph, has_audio = build_filter_graph(
        plan, logo_input=logo_input, music_input=music_input, narration_input=narration_input,
    )
    total = program_length(plan)
    cmd += ["-filter_complex", graph, "-map", "[vout]"]
    if has_audio:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-r", str(plan.fps), "-t", f"{total:.3f}",
        "-movflags", "+faststart", "-f", "mp4", str(out_path),
    ]
    return local_inputs_only(cmd, tool="ffmpeg")


# ── Beat sync ────────────────────────────────────────────────────────────


def detect_beats(samples, sample_rate: int, *, min_bpm: float = 70.0,
                 max_bpm: float = 180.0) -> tuple[float, float]:
    """``(period, phase)`` in seconds of the music's beat grid.

    Spectral-flux onsets, tempo from their autocorrelation, phase from the
    grid offset that lands on the most onset energy. Plain numpy, so the
    backend needs no audio-analysis package. Returns ``(0, 0)`` when there
    is too little audio to tell.
    """
    import numpy as np

    data = np.asarray(samples, dtype=np.float32).reshape(-1)
    hop, window = 256, 1024
    if data.size < window * 8 or sample_rate <= 0:
        return 0.0, 0.0
    frames = 1 + (data.size - window) // hop
    idx = np.arange(window)[None, :] + hop * np.arange(frames)[:, None]
    spectrum = np.abs(np.fft.rfft(data[idx] * np.hanning(window), axis=1))
    flux = np.maximum(0.0, np.diff(np.log1p(spectrum), axis=0)).sum(axis=1)
    flux = flux - flux.mean()
    if not np.any(flux > 0):
        return 0.0, 0.0
    frame_rate = sample_rate / hop
    lag_min = max(2, int(frame_rate * 60.0 / max_bpm))
    lag_max = min(flux.size - 2, int(frame_rate * 60.0 / min_bpm))
    if lag_max <= lag_min:
        return 0.0, 0.0
    corr = np.correlate(flux, flux, mode="full")[flux.size - 1:]
    # Autocorrelation peaks at the beat and at its multiples alike; weight
    # tempos towards 120 BPM (one octave of spread) so half or double time
    # does not win on a near tie.
    lags = np.arange(lag_min, lag_max + 1)
    bpm = 60.0 * frame_rate / lags
    weight = np.exp(-0.5 * np.log2(bpm / 120.0) ** 2)
    lag = lag_min + int(np.argmax(corr[lag_min:lag_max + 1] * weight))
    # Parabolic interpolation: the true period rarely falls on a whole hop,
    # and a whole-hop error drifts the grid by one hop every beat.
    a, b, c = corr[lag - 1], corr[lag], corr[lag + 1]
    denom = a - 2 * b + c
    shift = 0.5 * (a - c) / denom if denom != 0 else 0.0
    period = (lag + max(-0.5, min(0.5, shift))) / frame_rate
    # Flux n is the change into frame n+1; an onset peaks when it reaches
    # the centre of that frame's window.
    times = ((np.arange(flux.size) + 1) * hop + window / 2) / sample_rate
    positive = np.maximum(flux, 0.0)
    beats = np.arange(0.0, times[-1], period)
    candidates = np.arange(0.0, period, hop / sample_rate)
    scores = [np.interp(beats + phase, times, positive, right=0.0).sum() for phase in candidates]
    phase = float(candidates[int(np.argmax(scores))])
    return round(period, 4), round(phase % period, 4)


def snap_to_beats(plan: PromoPlan, period: float, phase: float) -> list[float]:
    """Shot durations whose cut points land on the beat grid.

    The music is started at ``phase`` (see the router), so beats sit at
    multiples of ``period`` from 0. Each boundary moves to the nearest beat
    that keeps every shot at least ``MIN_SHOT_SECONDS`` long; the last shot
    keeps its length. Returns the new durations (unchanged without a grid).
    """
    durations = [s.duration for s in plan.shots]
    if period <= 0 or len(durations) < 2:
        return durations
    _ = phase  # the grid is aligned to 0 by starting the music at the phase
    overlaps = [0.0] + [
        clamp_transition(s.transition_seconds, durations[i - 1], s.duration)
        if TRANSITIONS[s.transition] else 0.0
        for i, s in enumerate(plan.shots) if i > 0
    ]
    # Original boundary times (transition start into shot k).
    offsets = [0.0]
    length = durations[0]
    for k in range(1, len(durations)):
        offsets.append(length - overlaps[k])
        length += durations[k] - overlaps[k]
    snapped = [0.0]
    for k in range(1, len(durations)):
        earliest = snapped[-1] + MIN_SHOT_SECONDS
        beat = max(math.ceil(earliest / period), round(offsets[k] / period))
        snapped.append(round(beat * period, 3))
    out = []
    for k in range(len(durations)):
        if k == len(durations) - 1:
            out.append(durations[k])
            continue
        duration = snapped[k + 1] - snapped[k] + overlaps[k + 1]
        out.append(round(min(MAX_SHOT_SECONDS, max(MIN_SHOT_SECONDS, duration)), 3))
    return out
