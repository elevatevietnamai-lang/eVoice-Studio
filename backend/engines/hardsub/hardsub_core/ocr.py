"""OCR phụ đề cứng tiếng Trung và gộp các khung hình thành câu có timing."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import cv2
import numpy as np

from .hw import gpu_fallback, ort_providers
from .subs import Segment

CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
PUNCT_RE = re.compile(r"[\s\.,，。!！?？:：;；、\"'“”‘’《》<>()（）\-—…·~]+")


def _heuristic_cudnn() -> None:
    """RapidOCR creates its CUDA sessions with cudnn_conv_algo_search=EXHAUSTIVE, which
    benchmarks every convolution again for each new input shape. Recognition gets a new width
    for almost every line, so a 3-minute video paid that search hundreds of times. HEURISTIC
    picks an algorithm straight away and was as fast once warm (measured on an RTX 3060)."""
    try:
        from rapidocr_onnxruntime.utils import infer_engine as ie
    except Exception:
        return
    cls = getattr(ie, "OrtInferSession", None)
    orig = getattr(cls, "_get_ep_list", None)
    if orig is None or getattr(orig, "_hardsub_heuristic", False):
        return

    def _get_ep_list(self):
        eps = orig(self)
        out = []
        for ep in eps:
            if isinstance(ep, tuple) and ep[0] == "CUDAExecutionProvider" and isinstance(ep[1], dict):
                ep = (ep[0], {**ep[1], "cudnn_conv_algo_search": "HEURISTIC"})
            out.append(ep)
        return out

    _get_ep_list._hardsub_heuristic = True
    cls._get_ep_list = _get_ep_list


class OcrEngine:
    """Bọc RapidOCR, hỗ trợ cả gói `rapidocr` (mới) lẫn `rapidocr_onnxruntime` (cũ).
    Trả về list (box[x1,y1,x2,y2], text, score)."""

    def __init__(self, prefer_gpu: bool = True):
        use_cuda = prefer_gpu and "CUDAExecutionProvider" in ort_providers(True)
        # What we asked onnxruntime for; compared with what the sessions really got (see active).
        self.requested = ("CUDAExecutionProvider", "CPUExecutionProvider") if use_cuda \
            else ("CPUExecutionProvider",)
        self._new_api = False
        try:
            from rapidocr_onnxruntime import RapidOCR
            if use_cuda:
                _heuristic_cudnn()
            try:
                self.engine = RapidOCR(det_use_cuda=use_cuda, cls_use_cuda=use_cuda, rec_use_cuda=use_cuda)
            except TypeError:
                self.engine = RapidOCR()
        except ImportError:
            from rapidocr import RapidOCR  # rapidocr >= 2
            params = {"EngineConfig.onnxruntime.use_cuda": True} if use_cuda else None
            self.engine = RapidOCR(params=params) if params else RapidOCR()
            self._new_api = True

    @property
    def active(self) -> tuple[str, ...]:
        """Providers of the text-recognition session as onnxruntime really created it."""
        for part in ("text_rec", "text_det"):
            model = getattr(self.engine, part, None)
            infer = getattr(model, "infer", None) or getattr(model, "session", None)
            sess = getattr(infer, "session", infer)
            get = getattr(sess, "get_providers", None)
            if callable(get):
                try:
                    return tuple(get())
                except Exception:
                    pass
        return ()

    def recognize(self, crops: list) -> list[tuple[str, float]] | None:
        """Text of each crop (one line each) without running detection, or None when the
        installed RapidOCR has no separate recognizer. Detection upscales the band several times
        and is most of an OCR call; when the line's box is already known it is not needed."""
        rec = getattr(self.engine, "text_rec", None)
        if self._new_api or rec is None or not crops:
            return None
        res, _ = rec(crops)
        return [(str(t), float(sc)) for t, sc, *_ in res]

    @property
    def gpu_fallback(self) -> bool:
        active = self.active
        return bool(active) and gpu_fallback(self.requested, active)

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
    raw: list[tuple[float, list]] = []
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
            raw.append((idx / info.fps, lines))
            if progress and len(raw) % 10 == 0:
                progress(min(idx / total, 1.0), f"OCR {idx / info.fps:.0f}s / {info.duration:.0f}s")
        else:
            if not cap.grab():
                break
        idx += 1
    cap.release()
    static = static_overlays(raw, step / info.fps)
    min_line = subtitle_line_height(raw, W) * SMALL_TEXT_RATIO
    samples: list[Sample] = []
    for t, lines in raw:
        lines = [ln for ln in lines
                 if _overlay_key(*ln) not in static and ln[0][3] - ln[0][1] >= min_line]
        lines.sort(key=lambda r: (round(r[0][1] / max(1.0, (r[0][3] - r[0][1]) * 0.6)), r[0][0]))
        samples.append(Sample(t, _join_lines(lines), [b for b, _ in lines]))
    return samples


# A line under this share of the subtitle line height is UI or on-screen text, not a subtitle
# (app labels ~10 px or a speech bubble ~17 px against ~32 px subtitles in a 576p recording).
SMALL_TEXT_RATIO = 0.6


def subtitle_line_height(raw: list[tuple[float, list]], width: float) -> float:
    """Median height of the horizontally centred lines (subtitles are centred; UI labels and
    stickers mostly are not). 0 when nothing is centred, which disables the size filter."""
    hs = sorted(b[3] - b[1] for _, lines in raw for b, _ in lines
                if abs((b[0] + b[2]) / 2 - width / 2) < width * 0.1)
    return float(hs[len(hs) // 2]) if hs else 0.0


def _overlay_key(box, text) -> tuple:
    """Same text at (about) the same place: OCR boxes jitter by a few pixels between frames."""
    q = max(8.0, (box[3] - box[1]))
    return _norm(text), round((box[0] + box[2]) / 2 / q), round((box[1] + box[3]) / 2 / q)


def static_overlays(raw: list[tuple[float, list]], sample_period: float, min_seconds: float = 10.0,
                    min_share: float = 0.25, min_run_seconds: float = 15.0) -> set:
    """Text that never changes inside the subtitle band: app UI in a screen recording
    (labels such as "width / height / batch size"), a channel watermark, a fixed caption sticker.
    Real subtitles change every few seconds, so a line is dropped only when the same text sits at
    the same spot for at
    least `min_seconds` in total AND covers `min_share` of the video or stays `min_run_seconds`
    without a break. Short videos keep everything (`min_seconds`)."""
    if not raw:
        return set()
    seen: dict[tuple, list[int]] = {}
    for i, (_, lines) in enumerate(raw):
        for key in {_overlay_key(b, t) for b, t in lines}:
            if key[0]:
                seen.setdefault(key, []).append(i)
    static = set()
    for key, idxs in seen.items():
        if len(idxs) * sample_period < min_seconds:
            continue
        run = best = 1
        for a, b in zip(idxs, idxs[1:]):
            run = run + 1 if b - a <= 2 else 1  # one missed read does not break a run
            best = max(best, run)
        if len(idxs) >= min_share * len(raw) or best * sample_period >= min_run_seconds:
            static.add(key)
    return static


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


def group_samples(samples: list[Sample], sample_period: float, sim_thr: float = 0.7,
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
    recognize = getattr(engine, "recognize", None)

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

        lines = sorted(s.boxes, key=lambda b: (b[1], b[0]))

        def has_text(i):
            fr = frame_at(i)
            if fr is None:
                return False
            engine.frame_index = i  # gợi ý cho engine giả lập khi test; RapidOCR bỏ qua
            got = None
            if recognize:  # vị trí từng dòng đã biết: chỉ nhận dạng, bỏ bước dò chữ
                crops = []
                for b in lines:
                    pad = (b[3] - b[1]) * 0.15
                    bx1, by1 = int(max(0, b[0] - pad)), int(max(0, b[1] - pad))
                    bx2, by2 = int(min(info.width, b[2] + pad)), int(min(info.height, b[3] + pad))
                    if bx2 - bx1 > 1 and by2 - by1 > 1:
                        crops.append(fr[by1:by2, bx1:bx2])
                got = recognize(crops)
            if got is None:
                got = [(t, sc) for _, t, sc in engine(fr[y1:y2])]
            txt = "".join(t for t, sc in got if sc >= min_score)
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
                cjk_only=True, progress=None, engine=None) -> list[Segment]:
    engine = engine or OcrEngine(prefer_gpu)
    samples = scan_video(path, info, region, sample_fps, engine, min_score, cjk_only, progress)
    step = max(1, int(round(info.fps / sample_fps)))
    segs = group_samples(samples, step / info.fps, min_samples=2 if sample_fps >= 3 else 1,
                         fps=info.fps)
    if progress:
        progress(1.0, "Tinh chỉnh thời gian từng câu…")
    return refine_boundaries(path, info, segs, engine, step)
