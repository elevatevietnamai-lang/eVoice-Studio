"""OCR phụ đề cứng tiếng Trung và gộp các khung hình thành câu có timing."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import cv2
import numpy as np

from .hw import ort_providers
from .subs import Segment

CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
PUNCT_RE = re.compile(r"[\s\.,，。!！?？:：;；、\"'“”‘’《》<>()（）\-—…·~]+")


class OcrEngine:
    """Bọc RapidOCR, hỗ trợ cả gói `rapidocr` (mới) lẫn `rapidocr_onnxruntime` (cũ).
    Trả về list (box[x1,y1,x2,y2], text, score)."""

    def __init__(self, prefer_gpu: bool = True):
        use_cuda = prefer_gpu and "CUDAExecutionProvider" in ort_providers(True)
        self._new_api = False
        try:
            from rapidocr_onnxruntime import RapidOCR
            try:
                self.engine = RapidOCR(det_use_cuda=use_cuda, cls_use_cuda=use_cuda, rec_use_cuda=use_cuda)
            except TypeError:
                self.engine = RapidOCR()
        except ImportError:
            from rapidocr import RapidOCR  # rapidocr >= 2
            params = {"EngineConfig.onnxruntime.use_cuda": True} if use_cuda else None
            self.engine = RapidOCR(params=params) if params else RapidOCR()
            self._new_api = True

    def __call__(self, img: np.ndarray):
        out = []
        if self._new_api:
            res = self.engine(img)
            if res is None or getattr(res, "boxes", None) is None:
                return out
            items = zip(res.boxes, res.txts, res.scores)
        else:
            res, _ = self.engine(img)
            items = res or []
        for box, text, score in items:
            pts = np.asarray(box, dtype=np.float32).reshape(-1, 2)
            x1, y1 = pts.min(0)
            x2, y2 = pts.max(0)
            out.append(([float(x1), float(y1), float(x2), float(y2)], str(text), float(score)))
        return out


@dataclass
class Sample:
    t: float
    text: str
    boxes: list = field(default_factory=list)


def _norm(s: str) -> str:
    return PUNCT_RE.sub("", s)


def _similar(a: str, b: str, thr: float) -> bool:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    if a == b:
        return True
    return SequenceMatcher(None, a, b).ratio() >= thr


def scan_video(path: str, info, region: tuple[float, float], sample_fps: float,
               engine, min_score: float = 0.6, cjk_only: bool = True,
               progress=None) -> list[Sample]:
    """Đọc video theo bước, OCR vùng phụ đề, trả về các mẫu (thời điểm, chữ, box)."""
    H, W = info.height, info.width
    y0, y1 = int(H * region[0]), int(H * region[1])
    step = max(1, int(round(info.fps / sample_fps)))
    scale = 1.0
    if W > 1280:
        scale = 1280 / W
    min_h, max_h = H * 0.015, H * 0.18

    cap = cv2.VideoCapture(path)
    samples: list[Sample] = []
    idx = 0
    total = max(1, info.frames)
    while True:
        if idx % step == 0:
            ok, frame = cap.read()
            if not ok:
                break
            crop = frame[y0:y1]
            engine.frame_index = idx
            if scale != 1.0:
                crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            lines = []
            for (bx1, by1, bx2, by2), text, score in engine(crop):
                box = [bx1 / scale, by1 / scale + y0, bx2 / scale, by2 / scale + y0]
                bh = box[3] - box[1]
                if score < min_score or not (min_h <= bh <= max_h):
                    continue
                if cjk_only and not CJK_RE.search(text):
                    continue
                lines.append((box, text))
            lines.sort(key=lambda r: (round(r[0][1] / max(1.0, (r[0][3] - r[0][1]) * 0.6)), r[0][0]))
            text = _join_lines(lines)
            samples.append(Sample(idx / info.fps, text, [b for b, _ in lines]))
            if progress and len(samples) % 10 == 0:
                progress(min(idx / total, 1.0), f"OCR {idx / info.fps:.0f}s / {info.duration:.0f}s")
        else:
            if not cap.grab():
                break
        idx += 1
    cap.release()
    return samples


def _join_lines(lines) -> str:
    """Ghép các box: cùng hàng thì nối liền, khác hàng thì xuống dòng."""
    if not lines:
        return ""
    rows, cur, cur_y = [], [], None
    for box, text in lines:
        cy = (box[1] + box[3]) / 2
        h = box[3] - box[1]
        if cur_y is None or abs(cy - cur_y) < h * 0.6:
            cur.append(text)
            cur_y = cy if cur_y is None else cur_y
        else:
            rows.append("".join(cur))
            cur, cur_y = [text], cy
    rows.append("".join(cur))
    seen, uniq = set(), []
    for r in (r.strip() for r in rows):
        if r and r not in seen:
            seen.add(r)
            uniq.append(r)
    return "\n".join(uniq)


def group_samples(samples: list[Sample], sample_period: float, sim_thr: float = 0.6,
                  gap_tolerance: int = 1, min_samples: int = 2, fps: float = 25.0) -> list[Segment]:
    """Gộp các mẫu liên tiếp có chữ giống nhau thành một câu phụ đề."""
    segs: list[Segment] = []
    cur: list[Sample] = []
    gap = 0

    def close():
        nonlocal cur
        if cur and (len(cur) >= min_samples or sample_period >= 0.5):
            texts = Counter(s.text for s in cur)
            best = max(texts.items(), key=lambda kv: (kv[1], len(_norm(kv[0]))))[0]
            boxes = [b for s in cur for b in s.boxes]
            seg = Segment(len(segs) + 1,
                          max(0.0, cur[0].t - sample_period / 2),
                          cur[-1].t + sample_period / 2,
                          best, _merge_boxes(boxes))
            seg._f0 = int(round(cur[0].t * fps))   # khung mẫu đầu/cuối có chữ (cho tinh chỉnh)
            seg._f1 = int(round(cur[-1].t * fps))
            segs.append(seg)
        cur = []

    for s in samples:
        if not s.text:
            if cur:
                gap += 1
                if gap > gap_tolerance:
                    close()
                    gap = 0
            continue
        if cur and _similar(s.text, cur[-1].text, sim_thr):
            cur.append(s)
            gap = 0
        else:
            close()
            cur = [s]
            gap = 0
    close()
    return segs


def _merge_boxes(boxes: list, ) -> list:
    """Gộp các box chồng lấn (cùng dòng chữ ở nhiều khung hình) để mask gọn hơn."""
    if not boxes:
        return []
    merged: list[list[float]] = []
    for b in sorted(boxes, key=lambda b: (b[1], b[0])):
        for m in merged:
            ih = min(m[3], b[3]) - max(m[1], b[1])
            hmin = min(m[3] - m[1], b[3] - b[1])
            iw = min(m[2], b[2]) - max(m[0], b[0])
            if ih > 0.5 * hmin and iw > -hmin:  # cùng hàng và chạm/chồng nhau
                m[0], m[1] = min(m[0], b[0]), min(m[1], b[1])
                m[2], m[3] = max(m[2], b[2]), max(m[3], b[3])
                break
        else:
            merged.append(list(b))
    return [[round(float(v), 1) for v in m] for m in merged]


def refine_boundaries(path, info, segs: list[Segment], engine, step: int,
                      min_score: float = 0.5, sim_thr: float = 0.5):
    """Tinh chỉnh start/end tới mức khung hình: tìm nhị phân giữa mẫu OCR cuối có chữ và mẫu
    kế tiếp không có chữ, OCR lại đúng dải chứa câu đó. Giúp mask không che thừa khoảng
    trống ngắn giữa hai câu (nơi lấy được nền thật)."""
    if not segs or step <= 1:
        return segs
    cap = cv2.VideoCapture(path)
    cache: dict[int, np.ndarray | None] = {}

    def frame_at(i):
        if i not in cache:
            if len(cache) > 200:
                cache.clear()
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, fr = cap.read()
            cache[i] = fr if ok else None
        return cache[i]

    for s in segs:
        f_first, f_last = getattr(s, "_f0", None), getattr(s, "_f1", None)
        if f_first is None or not s.boxes:
            continue
        y1 = int(max(0, min(b[1] for b in s.boxes) - 8))
        y2 = int(min(info.height, max(b[3] for b in s.boxes) + 8))

        def has_text(i):
            fr = frame_at(i)
            if fr is None:
                return False
            engine.frame_index = i  # gợi ý cho engine giả lập khi test; RapidOCR bỏ qua
            txt = "".join(t for _, t, sc in engine(fr[y1:y2]) if sc >= min_score)
            return _similar(txt, s.text.replace("\n", ""), sim_thr)

        lo, hi = max(-1, f_first - step), f_first  # lo: không có chữ, hi: có chữ
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if has_text(mid):
                hi = mid
            else:
                lo = mid
        a = hi
        lo, hi = f_last, min(info.frames, f_last + step)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if has_text(mid):
                lo = mid
            else:
                hi = mid
        s.start, s.end = a / info.fps, (lo + 1) / info.fps
    cap.release()
    # tránh chồng lấn sau khi tinh chỉnh
    for p, n in zip(segs, segs[1:]):
        if p.end > n.start:
            p.end = n.start
    return segs


def extract_ocr(path, info, region, sample_fps, prefer_gpu=True, min_score=0.6,
                cjk_only=True, progress=None) -> list[Segment]:
    engine = OcrEngine(prefer_gpu)
    samples = scan_video(path, info, region, sample_fps, engine, min_score, cjk_only, progress)
    step = max(1, int(round(info.fps / sample_fps)))
    segs = group_samples(samples, step / info.fps, min_samples=2 if sample_fps >= 3 else 1,
                         fps=info.fps)
    if progress:
        progress(1.0, "Tinh chỉnh thời gian từng câu…")
    return refine_boundaries(path, info, segs, engine, step)
