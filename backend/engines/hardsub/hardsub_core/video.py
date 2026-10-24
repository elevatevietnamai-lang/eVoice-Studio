"""Đọc thông tin video, ghi video qua ffmpeg pipe."""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from fractions import Fraction

import cv2
import numpy as np

from .hw import ffmpeg_bin, ffprobe_bin, local_inputs_only, video_encoder


@dataclass
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float
    fps_str: str
    frames: int
    duration: float
    has_audio: bool


def probe(path: str) -> VideoInfo:
    out = subprocess.run(
        local_inputs_only([ffprobe_bin(), "-v", "error", "-print_format", "json", "-show_streams",
                           "-show_format", path]),
        capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    v = next(s for s in data["streams"] if s.get("codec_type") == "video")
    has_audio = any(s.get("codec_type") == "audio" for s in data["streams"])
    fps_str = v.get("avg_frame_rate") or v.get("r_frame_rate") or "25/1"
    if fps_str in ("0/0", "0"):
        fps_str = v.get("r_frame_rate", "25/1")
    fps = float(Fraction(fps_str))
    duration = float(data.get("format", {}).get("duration") or v.get("duration") or 0)
    frames = int(v.get("nb_frames") or 0)
    if frames <= 0:
        cap = cv2.VideoCapture(path)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or int(duration * fps)
        cap.release()
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = abs(int(sd["rotation"]))
    if rot in (90, 270):  # OpenCV tự xoay theo metadata
        w, h = h, w
    return VideoInfo(path, w, h, fps, fps_str, frames, duration, has_audio)


def read_frame_at(path: str, t: float) -> np.ndarray | None:
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


class VideoWriter:
    """Ghi frame BGR vào ffmpeg, ghép luôn audio gốc."""

    def __init__(self, out_path: str, info: VideoInfo, audio_src: str | None = None,
                 prefer_gpu: bool = True):
        enc, enc_args = video_encoder(prefer_gpu)
        cmd = [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{info.width}x{info.height}",
               "-r", info.fps_str, "-i", "-"]
        if audio_src and info.has_audio:
            cmd += ["-i", audio_src, "-map", "0:v", "-map", "1:a?", "-c:a", "copy"]
        cmd += ["-c:v", enc, *enc_args, "-pix_fmt", "yuv420p", out_path]
        cmd = local_inputs_only(cmd)
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    def write(self, frame: np.ndarray):
        self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())

    def close(self):
        self.proc.stdin.close()
        err = self.proc.stderr.read().decode(errors="ignore")
        if self.proc.wait() != 0:
            raise RuntimeError(f"ffmpeg lỗi khi ghi video:\n{err[-2000:]}")
