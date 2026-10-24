"""Hardware detection: ONNX providers and ffmpeg encoder."""
from __future__ import annotations

import functools
import platform
import shutil
import subprocess


def setup_cuda_dlls():
    """Windows: thêm DLL CUDA/cuDNN từ các gói pip nvidia-* vào đường tìm DLL
    (cần cho onnxruntime-gpu và faster-whisper khi chưa cài CUDA Toolkit)."""
    import os
    import sys
    import glob
    if sys.platform != "win32":
        return
    for sp in sys.path:
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            except Exception:
                pass


def ffmpeg_bin() -> str:
    """VoiceStudio passes its managed ffmpeg via HARDSUB_FFMPEG."""
    import os
    return os.environ.get("HARDSUB_FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"


def ffprobe_bin() -> str:
    import os
    env = os.environ.get("HARDSUB_FFPROBE")
    if env:
        return env
    ff = os.environ.get("HARDSUB_FFMPEG")
    if ff:  # ffprobe thường nằm cạnh ffmpeg
        cand = os.path.join(os.path.dirname(ff), os.path.basename(ff).replace("ffmpeg", "ffprobe"))
        if os.path.exists(cand):
            return cand
    return shutil.which("ffprobe") or "ffprobe"


@functools.lru_cache(maxsize=4)
def ort_providers(prefer_gpu: bool = True) -> tuple[str, ...]:
    """Thứ tự provider cho onnxruntime (OCR + LaMa)."""
    try:
        import onnxruntime as ort
        avail = set(ort.get_available_providers())
    except Exception:
        return ("CPUExecutionProvider",)
    order = []
    if prefer_gpu:
        for p in ("CUDAExecutionProvider", "CoreMLExecutionProvider", "DmlExecutionProvider"):
            if p in avail:
                order.append(p)
    order.append("CPUExecutionProvider")
    return tuple(order)


def _encoder_works(enc: str) -> bool:
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-f", "lavfi",
           "-i", "color=c=black:s=256x256:d=0.2", "-c:v", enc, "-f", "null", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, timeout=30).returncode == 0
    except Exception:
        return False


@functools.lru_cache(maxsize=2)
def video_encoder(prefer_gpu: bool = True) -> tuple[str, tuple[str, ...]]:
    """(tên encoder, tham số chất lượng). Ưu tiên encoder phần cứng nếu chạy được."""
    if prefer_gpu:
        candidates = []
        if platform.system() == "Darwin":
            candidates.append(("h264_videotoolbox", ("-q:v", "65")))
        candidates += [
            ("h264_nvenc", ("-preset", "p5", "-cq", "19", "-b:v", "0")),
            ("h264_qsv", ("-global_quality", "20")),
            ("h264_amf", ("-quality", "balanced", "-rc", "cqp", "-qp_i", "19", "-qp_p", "21")),
        ]
        for enc, args in candidates:
            if _encoder_works(enc):
                return enc, args
    return "libx264", ("-preset", "veryfast", "-crf", "18")
