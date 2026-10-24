"""Xóa phụ đề gốc bằng tái tạo khung hình.

Thứ tự lấp vùng chữ cho mỗi khung hình:
  1. Nền thật từ các khung hình lân cận (trước/sau) mà ở đó vùng này không bị chữ che,
     có căn chỉnh dịch chuyển camera và kiểm tra cảnh tĩnh quanh viền vùng chữ.
  2. Khung hình vừa xử lý trước đó (giữ tính liên tục, tránh nhấp nháy).
  3. Phần còn thiếu: LaMa (AI) hoặc OpenCV Telea (nhanh).
"""
from __future__ import annotations

import math
import os
import urllib.request
from collections import deque

import cv2
import numpy as np

from .hw import ort_providers
from .subs import Segment
from .video import VideoInfo, VideoWriter

LAMA_URLS = [
    "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
    "https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
]


def ensure_lama(models_dir: str, log=print) -> str:
    path = os.path.join(models_dir, "lama_fp32.onnx")
    if os.path.exists(path) and os.path.getsize(path) > 50_000_000:
        return path
    os.makedirs(models_dir, exist_ok=True)
    last = None
    for url in LAMA_URLS:
        try:
            log(f"Đang tải model LaMa (~200MB) từ {url} …")
            tmp = path + ".part"
            urllib.request.urlretrieve(url, tmp)
            os.replace(tmp, path)
            return path
        except Exception as e:  # thử mirror tiếp theo
            last = e
    raise RuntimeError(f"Không tải được model LaMa: {last}. Hãy tải thủ công lama_fp32.onnx vào {models_dir}")


class LamaOnnx:
    def __init__(self, model_path: str, prefer_gpu: bool = True):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.sess = None
        for provs in (list(ort_providers(prefer_gpu)), ["CPUExecutionProvider"]):
            try:
                self.sess = ort.InferenceSession(model_path, so, providers=provs)
                break
            except Exception:
                continue
        if self.sess is None:
            raise RuntimeError("Không khởi tạo được LaMa ONNX")
        ins = self.sess.get_inputs()
        names = [i.name for i in ins]
        self.img_name = next((n for n in names if "image" in n.lower()), names[0])
        self.mask_name = next((n for n in names if "mask" in n.lower()), names[1])
        shp = next(i.shape for i in ins if i.name == self.img_name)
        self.size = shp[2] if isinstance(shp[2], int) else 512
        self.out_name = self.sess.get_outputs()[0].name

    def run(self, img: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """img: BGR uint8 vuông bất kỳ, mask: bool. Trả về BGR uint8 cùng kích thước."""
        s = img.shape[0]
        n = self.size
        im = cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA if s > n else cv2.INTER_CUBIC)
        mk = cv2.resize(mask.astype(np.uint8), (n, n), interpolation=cv2.INTER_NEAREST)
        x = im[:, :, ::-1].astype(np.float32).transpose(2, 0, 1)[None] / 255.0
        m = (mk > 0).astype(np.float32)[None, None]
        out = self.sess.run([self.out_name], {self.img_name: x, self.mask_name: m})[0][0]
        if out.max() <= 1.5:
            out = out * 255.0
        out = np.clip(out.transpose(1, 2, 0), 0, 255).astype(np.uint8)[:, :, ::-1]
        return cv2.resize(out, (s, s), interpolation=cv2.INTER_CUBIC)


def _tent(n: int) -> np.ndarray:
    r = np.minimum(np.arange(n) + 1, np.arange(n)[::-1] + 1).astype(np.float32)
    return np.minimum(r / max(1.0, n * 0.25), 1.0)


class Filler:
    """Lấp vùng thiếu bằng AI (LaMa, chia ô vuông theo chiều ngang) hoặc OpenCV."""

    def __init__(self, method: str, models_dir: str, prefer_gpu: bool, log=print):
        self.method = method
        self.lama = None
        if method == "lama":
            try:
                self.lama = LamaOnnx(ensure_lama(models_dir, log), prefer_gpu)
            except Exception as e:
                log(f"⚠️ Không dùng được LaMa ({e}). Chuyển sang OpenCV.")
                self.method = "opencv"

    def fill(self, img: np.ndarray, hole: np.ndarray) -> np.ndarray:
        if not hole.any():
            return img
        if self.method != "lama":
            return cv2.inpaint(img, hole.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
        return self._lama_tiles(img, hole)

    def _lama_tiles(self, img, hole):
        H, W = hole.shape
        ys, xs = np.nonzero(hole)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        bh = y1 - y0
        side = int(min(min(H, W), max(256, bh * 2.2)))
        stride = max(1, int(side * 0.7))
        cy = (y0 + y1) // 2
        if bh <= side * 0.8:
            y_starts = [int(np.clip(cy - side // 2, 0, H - side))]
        else:
            y_starts = list(range(max(0, y0 - side // 4), max(1, y1 - side // 2), stride))
            y_starts = sorted({int(np.clip(v, 0, H - side)) for v in y_starts})
        x_lo = max(0, x0 - side // 4)
        x_hi = min(W, x1 + side // 4)
        x_starts = list(range(x_lo, max(x_lo + 1, x_hi - side + 1), stride))
        if not x_starts or x_starts[-1] + side < x_hi:
            x_starts.append(x_hi - side)
        x_starts = sorted({int(np.clip(v, 0, W - side)) for v in x_starts})

        acc = np.zeros((H, W, 3), np.float32)
        wsum = np.zeros((H, W), np.float32)
        wt = np.outer(_tent(side), _tent(side))
        for ty in y_starts:
            for tx in x_starts:
                m = hole[ty:ty + side, tx:tx + side]
                if not m.any():
                    continue
                out = self.lama.run(img[ty:ty + side, tx:tx + side], m)
                acc[ty:ty + side, tx:tx + side] += out.astype(np.float32) * wt[..., None]
                wsum[ty:ty + side, tx:tx + side] += wt
        res = img.copy()
        ok = hole & (wsum > 0)
        res[ok] = np.clip(np.round(acc[ok] / wsum[ok][:, None]), 0, 255).astype(np.uint8)
        miss = hole & ~ok
        if miss.any():
            res = cv2.inpaint(res, miss.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
        return res


# ----------------------------------------------------------------------------- temporal

def _gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _estimate_shift(g_cur, g_ref, invalid):
    """Dịch chuyển (dx, dy) của ref so với cur, bỏ qua vùng chữ."""
    a, b = g_cur.copy(), g_ref.copy()
    if invalid.any():
        a[invalid] = a[~invalid].mean() if (~invalid).any() else 0
        b[invalid] = b[~invalid].mean() if (~invalid).any() else 0
    win = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(b, a, win)
    return dx, dy, resp


def temporal_fill(cur, hole, cands, ring_px=12, diff_thr=6.0, max_tries=16, match_frac=0.85):
    """cands: list (ảnh band, valid bool) theo thứ tự ưu tiên. Trả (ảnh, phần còn thiếu)."""
    out = cur.copy()
    remaining = hole.copy()
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_px + 1, 2 * ring_px + 1))
    ring = cv2.dilate(hole.astype(np.uint8), k).astype(bool) & ~hole
    ring_n = ring.sum()
    if ring_n == 0:
        return out, remaining
    g_cur = _gray(cur)
    tries = 0
    for img, valid in cands:
        if not remaining.any() or tries >= max_tries:
            break
        if not (remaining & valid).any():
            continue
        tries += 1
        g = _gray(img)
        dx, dy, resp = _estimate_shift(g_cur, g, hole | ~valid)
        if resp > 0.25 and (abs(dx) > 0.5 or abs(dy) > 0.5):
            if abs(dx) > cur.shape[1] / 4 or abs(dy) > cur.shape[0] / 4:
                continue
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            size = (cur.shape[1], cur.shape[0])
            img = cv2.warpAffine(img, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            valid = cv2.warpAffine(valid.astype(np.uint8), M, size, flags=cv2.INTER_NEAREST,
                                   borderValue=0).astype(bool)
            g = _gray(img)
        r = ring & valid
        if r.sum() < 0.35 * ring_n:
            continue
        d = np.abs(g_cur[r] - g[r])
        match = d < diff_thr * 2
        # cảnh coi là cùng nền nếu đa số viền khớp (chịu được vật thể nhỏ đi ngang)
        if match.mean() < match_frac:
            continue
        take = remaining & valid
        if not take.any():
            continue
        # cân bằng sáng theo phần viền khớp để tránh vệt
        cm = cur[r][match].astype(np.float32)
        im = img[r][match].astype(np.float32)
        off = np.median(cm, 0) - np.median(im, 0)
        if np.abs(off).max() > 10:
            continue  # lệch màu lớn: nhiều khả năng không phải cùng nền
        out[take] = np.clip(img[take].astype(np.float32) + off, 0, 255).astype(np.uint8)
        remaining &= ~take
    return out, remaining


def _feather_blend(orig, filled, hole, px=3):
    """Làm mềm mép vùng lấp để không thấy đường cắt."""
    if px <= 0:
        return filled
    m = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), px)
    m = np.maximum(m, hole.astype(np.float32))[..., None]
    return (filled.astype(np.float32) * m + orig.astype(np.float32) * (1 - m)).astype(np.uint8)


# ----------------------------------------------------------------------------- masks

class MaskPlan:
    """Mask theo từng khung hình, tính trong 'band' (dải hàng chứa phụ đề) để tiết kiệm."""

    def __init__(self, segs: list[Segment], info: VideoInfo, time_margin: float, pad_ratio: float = 0.3):
        H, W = info.height, info.width
        boxes = [b for s in segs for b in s.boxes]
        if not boxes:
            self.empty = True
            return
        self.empty = False
        ys0 = min(b[1] for b in boxes)
        ys1 = max(b[3] for b in boxes)
        hmax = max(b[3] - b[1] for b in boxes)
        extra = int(hmax * 2.5) + 16
        self.by0 = max(0, int(ys0 - extra))
        self.by1 = min(H, int(ys1 + extra))
        bw = W
        self.seg_masks = []
        self.frame_map: dict[int, list[int]] = {}
        for si, s in enumerate(segs):
            if not s.boxes:
                continue
            m = np.zeros((self.by1 - self.by0, bw), np.uint8)
            for x1, y1, x2, y2 in s.boxes:
                p = int((y2 - y1) * pad_ratio) + 4
                cv2.rectangle(m, (int(x1) - p, int(y1) - self.by0 - p),
                              (int(x2) + p, int(y2) - self.by0 + p), 1, -1)
            self.seg_masks.append(m.astype(bool))
            mi = len(self.seg_masks) - 1
            f0 = max(0, int(math.floor((s.start - time_margin) * info.fps)))
            f1 = min(info.frames + 10, int(math.ceil((s.end + time_margin) * info.fps)))
            for f in range(f0, f1 + 1):
                self.frame_map.setdefault(f, []).append(mi)

    def hole(self, f: int):
        ids = self.frame_map.get(f)
        if not ids:
            return None
        m = self.seg_masks[ids[0]].copy()
        for i in ids[1:]:
            m |= self.seg_masks[i]
        return m


def remove_subtitles(src: str, out_path: str, info: VideoInfo, segs: list[Segment],
                     method: str = "lama", models_dir: str = "models", prefer_gpu: bool = True,
                     time_margin: float = 0.08, window_sec: float = 2.5,
                     use_temporal: bool = True, progress=None, log=print) -> str:
    """Tạo video sạch phụ đề. method: 'lama' | 'opencv'."""
    plan = MaskPlan(segs, info, time_margin)
    if plan.empty:
        raise RuntimeError("Không có vị trí phụ đề (box) nào để xóa.")
    filler = Filler(method, models_dir, prefer_gpu, log)
    by0, by1 = plan.by0, plan.by1
    Wn = max(2, int(round(window_sec * info.fps)))

    cap = cv2.VideoCapture(src)
    writer = VideoWriter(out_path, info, audio_src=src, prefer_gpu=prefer_gpu)
    frames: deque = deque()      # (idx, full frame) chờ xuất
    bands: dict[int, np.ndarray] = {}  # band gốc trong cửa sổ
    holes: dict[int, np.ndarray | None] = {}
    prev_out_band = None
    read_idx = 0
    out_idx = 0
    eof = False
    total = max(1, info.frames)
    n_ai = n_temporal = 0

    def process(t, frame):
        nonlocal prev_out_band, n_ai, n_temporal
        hole = holes.get(t)
        band = bands[t]
        if hole is None or not hole.any():
            prev_out_band = band
            return frame
        filled = band
        remaining = hole
        if use_temporal:
            cands = []
            for d in range(1, Wn + 1):
                for s in (t + d, t - d):
                    if s in bands:
                        hs = holes.get(s)
                        cands.append((bands[s], ~hs if hs is not None else np.ones_like(hole)))
            if prev_out_band is not None:  # nền thật ưu tiên trước, rồi mới tới khung đã lấp
                cands.append((prev_out_band, np.ones_like(hole)))
            filled, remaining = temporal_fill(band, hole, cands)
            if remaining.sum() < hole.sum():
                n_temporal += 1
        if remaining.any():
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            remaining = cv2.dilate(remaining.astype(np.uint8), k).astype(bool) & hole
            filled = filler.fill(filled, remaining)
            n_ai += 1
        filled = _feather_blend(band, filled, hole)
        out = frame.copy()
        out[by0:by1] = filled
        prev_out_band = filled
        return out

    while True:
        # đọc trước Wn khung hình để có "tương lai"
        while not eof and read_idx <= out_idx + Wn:
            ok, fr = cap.read()
            if not ok:
                eof = True
                break
            frames.append((read_idx, fr))
            bands[read_idx] = fr[by0:by1].copy()
            holes[read_idx] = plan.hole(read_idx)
            read_idx += 1
        if not frames:
            break
        t, fr = frames.popleft()
        writer.write(process(t, fr))
        out_idx = t + 1
        for old in [k for k in bands if k < t - Wn]:
            bands.pop(old, None)
            holes.pop(old, None)
        if progress and t % 15 == 0:
            progress(min(t / total, 1.0), f"Xóa phụ đề: khung {t}/{total}")
    cap.release()
    writer.close()
    log(f"Xóa phụ đề xong: {n_temporal} khung dùng nền thật từ khung lân cận, {n_ai} khung cần AI/OpenCV lấp.")
    return out_path
