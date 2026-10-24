"""Hardcoded-subtitle engine CLI (runs inside its own venv).

    python cli.py probe
    python cli.py ocr   --video V --top 0.62 --bottom 0.98 --fps 4 --out cues.json
    python cli.py clean --video V --cues cues.json --method lama --out clean.mp4 --models DIR

Progress is printed to stdout as one JSON object per line:
    {"type": "progress", "progress": 0.42, "message": "..."}
    {"type": "result", ...}
    {"type": "error", "message": "..."}
"""
from __future__ import annotations

import argparse
import os

# OpenCV's bundled FFmpeg must not follow URLs inside a crafted "video" (set before cv2 is imported).
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "protocol_whitelist;file,pipe")
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from hardsub_core import hw  # noqa: E402

hw.setup_cuda_dlls()


def emit(obj: dict):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Progress:
    """Throttled progress reporter."""

    def __init__(self, lo: float = 0.0, hi: float = 1.0):
        self.lo, self.hi = lo, hi
        self.last = 0.0

    def __call__(self, frac: float, message: str = ""):
        now = time.monotonic()
        if now - self.last < 0.4 and frac < 1.0:
            return
        self.last = now
        emit({"type": "progress", "progress": round(self.lo + (self.hi - self.lo) * max(0.0, min(frac, 1.0)), 4),
              "message": message})


def cmd_probe(_args):
    import onnxruntime as ort
    enc, _ = hw.video_encoder(True)
    ocr_ok = True
    try:
        from hardsub_core.ocr import OcrEngine  # noqa: F401
        import rapidocr_onnxruntime  # noqa: F401
    except Exception:
        try:
            import rapidocr  # noqa: F401
        except Exception:
            ocr_ok = False
    emit({"type": "result", "providers": list(ort.get_available_providers()),
          "encoder": enc, "ocr": ocr_ok, "python": sys.version.split()[0]})


def cmd_ocr(args):
    from hardsub_core.video import probe
    from hardsub_core.ocr import extract_ocr

    info = probe(args.video)
    emit({"type": "progress", "progress": 0.0, "message": "Loading OCR model"})
    segs = extract_ocr(args.video, info, (args.top, args.bottom), args.fps,
                       prefer_gpu=not args.cpu, min_score=args.min_score,
                       cjk_only=not args.any_script, progress=Progress(0.0, 0.98))
    cues = [s.to_dict() for s in segs]
    payload = {"width": info.width, "height": info.height, "fps": info.fps,
               "duration": info.duration, "region": [args.top, args.bottom], "cues": cues}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    emit({"type": "result", "count": len(cues), "out": args.out})


def cmd_clean(args):
    from hardsub_core.video import probe
    from hardsub_core.subs import Segment
    from hardsub_core.inpaint import remove_subtitles

    with open(args.cues, encoding="utf-8") as f:
        data = json.load(f)
    segs = [Segment.from_dict(c) for c in data.get("cues", [])]
    if not any(s.boxes for s in segs):
        raise RuntimeError("No subtitle positions to remove. Run OCR first.")
    info = probe(args.video)
    t0 = time.time()
    remove_subtitles(args.video, args.out, info, segs, method=args.method, models_dir=args.models,
                     prefer_gpu=not args.cpu, progress=Progress(0.0, 0.99),
                     log=lambda m: emit({"type": "log", "message": m}))
    emit({"type": "result", "out": args.out, "seconds": round(time.time() - t0, 1)})


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    o = sub.add_parser("ocr")
    o.add_argument("--video", required=True)
    o.add_argument("--top", type=float, default=0.62)
    o.add_argument("--bottom", type=float, default=0.98)
    o.add_argument("--fps", type=float, default=4.0)
    o.add_argument("--min-score", type=float, default=0.6)
    o.add_argument("--any-script", action="store_true", help="Keep non-CJK text too")
    o.add_argument("--cpu", action="store_true")
    o.add_argument("--out", required=True)
    c = sub.add_parser("clean")
    c.add_argument("--video", required=True)
    c.add_argument("--cues", required=True)
    c.add_argument("--method", choices=["lama", "sttn", "propainter", "opencv"], default="lama")
    c.add_argument("--models", default=os.path.join(HERE, "models"))
    c.add_argument("--cpu", action="store_true")
    c.add_argument("--out", required=True)
    args = ap.parse_args()
    try:
        {"probe": cmd_probe, "ocr": cmd_ocr, "clean": cmd_clean}[args.cmd](args)
    except Exception as e:  # report to the backend as a structured event
        emit({"type": "error", "message": str(e), "trace": traceback.format_exc()[-2000:]})
        sys.exit(1)


if __name__ == "__main__":
    main()
