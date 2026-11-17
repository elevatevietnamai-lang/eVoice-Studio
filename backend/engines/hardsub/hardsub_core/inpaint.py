"""Xóa phụ đề gốc bằng tái tạo khung hình.

Thứ tự lấp vùng chữ cho mỗi khung hình:
  1. Nền thật từ các khung hình lân cận (trước/sau) mà ở đó vùng này không bị chữ che,
     có căn chỉnh dịch chuyển camera và kiểm tra cảnh tĩnh quanh viền vùng chữ.
  2. Khung hình vừa xử lý trước đó (giữ tính liên tục, tránh nhấp nháy).
  3. Phần còn thiếu: LaMa (AI) hoặc OpenCV Telea (nhanh).

Chế độ (method):
  sttn       nền thật từ nhiều khung lân cận, lấy trung vị; phần chưa từng lộ thì OpenCV (nhanh nhất).
  lama       nền thật từ khung lân cận gần nhất, phần còn thiếu do LaMa vẽ (mặc định).
  propainter nền thật lấy trung vị + LaMa tinh chỉnh toàn vùng (pha 65/35) để xóa vệt răng cưa.
  opencv     tên cũ của sttn.
Lưu ý: sttn/propainter theo cách đặt tên của VideoSubtitleRemover (MIT); đó là thuật toán lai
nền-thời-gian, KHÔNG phải mạng STTN/ProPainter gốc và không dùng trọng số của chúng.
"""
from __future__ import annotations

import hashlib
import math
import os
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

from .hw import gpu_fallback, ort_providers
from .subs import Segment
from .video import VideoInfo, VideoWriter

METHODS = ("sttn", "lama", "propainter", "opencv")
MEDIAN_FRAMES = {"sttn": 5, "propainter": 5}
PROPAINTER_TEMPORAL_WEIGHT = 0.65
# Reusing the previous clean frame's fill (see TemporalFill.feed_previous).
REUSE_NEAR_PX = 24
REUSE_NEAR_CHANGED = 0.005
REUSE_WIDE_CHANGED = 0.05

# Pinned to one Hugging Face commit and one SHA-256: a swapped file (or a mirror serving a different
# one) is rejected before it ever reaches onnxruntime.
LAMA_REVISION = "c3c0c9e468934d62e79c329e35d82dd09ff8c444"
LAMA_SHA256 = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"
LAMA_SIZE = 208044816
LAMA_URLS = [
    f"https://huggingface.co/Carve/LaMa-ONNX/resolve/{LAMA_REVISION}/lama_fp32.onnx",
    f"https://hf-mirror.com/Carve/LaMa-ONNX/resolve/{LAMA_REVISION}/lama_fp32.onnx",
]


def _sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_verified(url: str, tmp: str) -> None:
    h = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
        for chunk in iter(lambda: resp.read(1 << 20), b""):
            size += len(chunk)
            if size > LAMA_SIZE:
                raise RuntimeError("LaMa download is larger than expected")
            h.update(chunk)
            out.write(chunk)
    if size != LAMA_SIZE or h.hexdigest() != LAMA_SHA256:
        raise RuntimeError("LaMa download failed its integrity check")


def ensure_lama(models_dir: str, log=print) -> str:
    path = os.path.join(models_dir, "lama_fp32.onnx")
    if os.path.exists(path) and os.path.getsize(path) == LAMA_SIZE and _sha256_of(path) == LAMA_SHA256:
        return path
    os.makedirs(models_dir, exist_ok=True)
    last = None
    for url in LAMA_URLS:
        tmp = path + ".part"
        try:
            log(f"Đang tải model LaMa (~200MB) từ {url} …")
            _download_verified(url, tmp)
            os.replace(tmp, path)
            return path
        except Exception as e:  # thử nguồn tiếp theo
            last = e
            try:
                os.remove(tmp)
            except OSError:
                pass
    raise RuntimeError(f"Không tải được model LaMa: {last}. Hãy tải thủ công lama_fp32.onnx vào {models_dir}")


class LamaOnnx:
    def __init__(self, model_path: str, prefer_gpu: bool = True):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # One tile per run. A fixed batch lets onnxruntime fold the shape-derived Fourier
        # matrices this export rebuilds on every run: ~5x faster session start, ~7% faster runs.
        so.add_free_dimension_override_by_name("batch", 1)
        self.sess = None
        requested = list(ort_providers(prefer_gpu))
        for provs in (requested, ["CPUExecutionProvider"]):
            try:
                self.sess = ort.InferenceSession(model_path, so, providers=provs)
                break
            except Exception:
                continue
        if self.sess is None:
            raise RuntimeError("Không khởi tạo được LaMa ONNX")
        # onnxruntime drops a GPU provider that fails to load without raising.
        self.gpu_fallback = gpu_fallback(requested, self.sess.get_providers())
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

    def __init__(self, method: str, models_dir: str, prefer_gpu: bool, log=print, warn=None):
        if method not in METHODS:
            raise ValueError(f"method phải thuộc {METHODS}")
        self.requested = "sttn" if method == "opencv" else method
        self.method = self.requested
        self.lama = None
        if method in ("lama", "propainter"):
            try:
                self.lama = LamaOnnx(ensure_lama(models_dir, log), prefer_gpu)
                if self.lama.gpu_fallback and warn:
                    warn("gpu_fallback")
            except Exception as e:
                log(f"⚠️ Không dùng được LaMa ({e}). Chuyển sang OpenCV.")
                self.method = "sttn"

    def fill(self, img: np.ndarray, hole: np.ndarray) -> np.ndarray:
        if not hole.any():
            return img
        if self.lama is None:
            return cv2.inpaint(img, hole.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
        return self._lama_tiles(img, hole)

    def _lama_tiles(self, img, hole):
        H, W = hole.shape
        ys, xs = np.nonzero(hole)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        bh = y1 - y0
        # Tiles at the model's own size, cut from the whole frame: native pixels, real context above
        # the band, and ~3x fewer runs than band-high tiles blown up to the model size.
        side = int(min(min(H, W), max(self.lama.size, bh * 2.2)))
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


def _ring_match(g_cur, g, ring, ring_n, valid, diff_thr, match_frac):
    """(ring pixels compared, which of them match) when `g` shows the same background, else None."""
    r = ring & valid
    if r.sum() < 0.35 * ring_n:
        return None
    match = np.abs(g_cur[r] - g[r]) < diff_thr * 2
    # cảnh coi là cùng nền nếu đa số viền khớp (chịu được vật thể nhỏ đi ngang)
    if match.mean() < match_frac:
        return None
    return r, match


def temporal_fill(cur, hole, cands, ring_px=12, diff_thr=6.0, max_tries=16, match_frac=0.85,
                  median_of=1, previous=None):
    """cands: list (ảnh band, valid bool) theo thứ tự ưu tiên. Trả (ảnh, phần còn thiếu).

    median_of > 1: gom tối đa ngần ấy khung khớp nền rồi lấy trung vị từng điểm ảnh (loại vật thể
    đi ngang); =1: lấy từ khung khớp đầu tiên (nhanh hơn).

    previous: (previous clean band, anchor band, anchor valid) tried after `cands` and outside the
    `max_tries` budget; see `TemporalFill.feed_previous`."""
    tf = TemporalFill(cur, hole, ring_px, diff_thr, max_tries, match_frac, median_of)
    tf.feed(cands)
    if previous is not None:
        tf.feed_previous(*previous)
    return tf.result()


class TemporalFill:
    """`temporal_fill` in two steps: `feed` the real neighbours (needs only the source frames, so it
    can run ahead on a worker thread), then `feed_previous` and take `result`."""

    def __init__(self, cur, hole, ring_px=12, diff_thr=6.0, max_tries=16, match_frac=0.85,
                 median_of=1):
        self.cur, self.hole = cur, hole
        self.diff_thr, self.max_tries, self.match_frac, self.median_of = (
            diff_thr, max_tries, match_frac, median_of)
        self.out = cur.copy()
        self.remaining = hole.copy()
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_px + 1, 2 * ring_px + 1))
        self.ring = cv2.dilate(hole.astype(np.uint8), k).astype(bool) & ~hole
        self.ring_n = self.ring.sum()
        self.g_cur = _gray(cur) if self.ring_n else None
        self.tries = 0
        self.stack: list[tuple[np.ndarray, np.ndarray]] = []
        self.votes = np.zeros(hole.shape, np.int16)

    def feed(self, cands):
        if self.ring_n == 0:
            return
        cur, hole, ring, ring_n, g_cur = self.cur, self.hole, self.ring, self.ring_n, self.g_cur
        diff_thr, match_frac, median_of = self.diff_thr, self.match_frac, self.median_of
        remaining, votes = self.remaining, self.votes
        for img, valid in cands:
            if self.tries >= self.max_tries:
                return
            if median_of <= 1 and not remaining.any():
                return
            if median_of > 1 and hole.any() and votes[hole].min() >= median_of:
                return
            if not ((remaining if median_of <= 1 else hole) & valid).any():
                continue
            self.tries += 1
            g = _gray(img)
            # A still shot already matches where it is: skip the phase correlation (the costliest
            # step on the CPU) and only search for camera motion when it does not.
            hit = _ring_match(g_cur, g, ring, ring_n, valid, diff_thr, match_frac)
            if hit is None:
                dx, dy, resp = _estimate_shift(g_cur, g, hole | ~valid)
                if not (resp > 0.25 and (abs(dx) > 0.5 or abs(dy) > 0.5)):
                    continue
                if abs(dx) > cur.shape[1] / 4 or abs(dy) > cur.shape[0] / 4:
                    continue
                M = np.float32([[1, 0, dx], [0, 1, dy]])
                size = (cur.shape[1], cur.shape[0])
                img = cv2.warpAffine(img, M, size, flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_REFLECT)
                valid = cv2.warpAffine(valid.astype(np.uint8), M, size, flags=cv2.INTER_NEAREST,
                                       borderValue=0).astype(bool)
                g = _gray(img)
                hit = _ring_match(g_cur, g, ring, ring_n, valid, diff_thr, match_frac)
                if hit is None:
                    continue
            self._apply(img, valid, img, *hit)

    def feed_previous(self, img, anchor, anchor_valid) -> bool:
        """Offer `img`, the clean band made for `anchor`, for whatever the neighbours left.

        `anchor` is the source band of the last frame filled without this shortcut and `img` is
        that frame's output. Copying from that one output (never from the previous frame's copy of
        it) and comparing with that one source means neither the scene check nor the colour
        correction can drift a step at a time. The fill is reused only
        while the surroundings still match the anchor: within `REUSE_NEAR_PX` of the hole at most
        `REUSE_NEAR_CHANGED` of the pixels may differ, and across the band around it (full band
        height, a band height either side) at most `REUSE_WIDE_CHANGED`. LaMa ignores the pixels
        under the mask, so near-unchanged surroundings give a near-identical fill (its tiles also see
        rows above the band, which this check leaves out). A thin ring is not enough: a
        subtitle's own box or shadow outside the mask stays put while the scene behind it changes.
        Neighbours from other cues each expose a sliver of the hole and can use up `max_tries`, so
        this runs outside that budget. True when it was used."""
        if self.median_of <= 1 and not self.remaining.any():
            return False
        hole = self.hole
        Hb, Wb = hole.shape
        blocked = hole | ~anchor_valid
        xs = np.nonzero(blocked.any(0))[0]
        if xs.size == 0:
            return False
        x0, x1 = max(0, xs.min() - Hb), min(Wb, xs.max() + 1 + Hb)
        blocked = cv2.dilate(blocked.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        wide = np.zeros_like(hole)
        wide[:, x0:x1] = True
        wide &= ~blocked
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * REUSE_NEAR_PX + 1,) * 2)
        near = cv2.dilate(hole.astype(np.uint8), k).astype(bool) & wide
        if near.sum() < 0.35 * self.ring_n or wide.sum() < 0.25 * Hb * (x1 - x0):
            return False
        g_cur = self.g_cur if self.g_cur is not None else _gray(self.cur)
        changed = np.abs(g_cur - _gray(anchor)) >= self.diff_thr * 2
        if changed[near].mean() > REUSE_NEAR_CHANGED or changed[wide].mean() > REUSE_WIDE_CHANGED:
            return False
        return self._apply(img, np.ones_like(hole), anchor, near, ~changed[near])

    def _apply(self, img, valid, ref, r, match) -> bool:
        """Copy `img` into the hole where `valid`, colour-matched on the ring through `ref`."""
        median_of, remaining, votes = self.median_of, self.remaining, self.votes
        take = (remaining if median_of <= 1 else self.hole & (votes < median_of)) & valid
        if not take.any():
            return False
        # cân bằng sáng theo phần viền khớp để tránh vệt
        cm = self.cur[r][match].astype(np.float32)
        im = ref[r][match].astype(np.float32)
        off = np.median(cm, 0) - np.median(im, 0)
        if np.abs(off).max() > 10:
            return False  # lệch màu lớn: nhiều khả năng không phải cùng nền
        fixed = np.clip(img.astype(np.float32) + off, 0, 255)
        if median_of <= 1:
            self.out[take] = fixed[take].astype(np.uint8)
            remaining &= ~take
        else:
            self.stack.append((fixed, take))
            votes += take
        return True

    def result(self):
        out, remaining = self.out, self.remaining
        if self.stack:
            arr = np.stack([np.where(t[..., None], f, np.nan) for f, t in self.stack])
            covered = self.votes > 0
            med = np.nanmedian(arr[:, covered], axis=0)
            out[covered] = np.clip(np.round(med), 0, 255).astype(np.uint8)
            remaining &= ~covered
        return out, remaining


def _feather_blend(orig, filled, hole, px=3):
    """Làm mềm mép vùng lấp để không thấy đường cắt."""
    if px <= 0 or not hole.any():
        return filled
    # Only the hole's bounding box plus the blur's reach changes; work there instead of the band.
    pad = 4 * px + 1  # > OpenCV's float Gaussian radius (4·sigma), so the result is identical
    ys, xs = np.nonzero(hole)
    y0, y1 = max(0, ys.min() - pad), min(hole.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(hole.shape[1], xs.max() + 1 + pad)
    h = hole[y0:y1, x0:x1].astype(np.float32)
    m = np.maximum(cv2.GaussianBlur(h, (0, 0), px), h)[..., None]
    out = orig.copy()
    out[y0:y1, x0:x1] = (filled[y0:y1, x0:x1].astype(np.float32) * m
                         + orig[y0:y1, x0:x1].astype(np.float32) * (1 - m)).astype(np.uint8)
    return out


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
                     use_temporal: bool = True, progress=None, log=print, warn=None) -> str:
    """Tạo video sạch phụ đề. method: 'sttn' | 'lama' | 'propainter' | 'opencv' (= sttn)."""
    plan = MaskPlan(segs, info, time_margin)
    if plan.empty:
        raise RuntimeError("Không có vị trí phụ đề (box) nào để xóa.")
    filler = Filler(method, models_dir, prefer_gpu, log, warn)
    by0, by1 = plan.by0, plan.by1
    Wn = max(2, int(round(window_sec * info.fps)))

    cap = cv2.VideoCapture(src)
    writer = VideoWriter(out_path, info, audio_src=src, prefer_gpu=prefer_gpu)
    frames: deque = deque()      # (idx, full frame) chờ xuất
    bands: dict[int, np.ndarray] = {}  # band gốc trong cửa sổ
    holes: dict[int, np.ndarray | None] = {}
    valids: dict[int, np.ndarray] = {}  # ~hole, built once per frame instead of once per pairing
    all_valid = np.ones((by1 - by0, info.width), bool)
    # (source band, its valid mask, its clean output) of the last frame not filled by reuse
    anchor = None
    prev_out_band = None  # median modes vote with the previous clean band, as before
    read_idx = 0
    out_idx = 0
    eof = False
    total = max(1, info.frames)
    n_ai = n_temporal = 0
    median_of = MEDIAN_FRAMES.get(filler.requested, 1)
    # The neighbour pass of a frame needs only source frames, so workers run it a few frames
    # ahead while the main thread waits on LaMa. Same candidates, same order: same output.
    workers = max(1, min(4, (os.cpu_count() or 2) - 1)) if use_temporal else 0
    ahead = 2 * workers
    pool = ThreadPoolExecutor(workers, thread_name_prefix="hardsub-temporal") if workers else None
    pending: dict[int, tuple] = {}
    queued = 0  # first frame whose neighbour pass is not queued yet

    def queue_neighbours(t):
        hole = holes.get(t)
        if hole is None or not hole.any():
            return
        cands = []
        for d in range(1, Wn + 1):
            for s in (t + d, t - d):
                if s in bands:
                    cands.append((bands[s], valids[s]))
        tf = TemporalFill(bands[t], hole, median_of=median_of)
        pending[t] = (pool.submit(tf.feed, cands), tf)

    def fill_in_frame(frame, band_img, mask):
        """Fill `mask` of the band; LaMa sees the band inside its whole frame for context."""
        if filler.lama is None:
            return filler.fill(band_img, mask)
        full = frame.copy()
        full[by0:by1] = band_img
        m = np.zeros(full.shape[:2], bool)
        m[by0:by1] = mask
        return filler.fill(full, m)[by0:by1]

    def process(t, frame):
        nonlocal anchor, prev_out_band, n_ai, n_temporal
        hole = holes.get(t)
        band = bands[t]
        if hole is None or not hole.any():
            anchor = (band, all_valid, band)
            prev_out_band = band
            return frame
        reused = False
        filled = band
        remaining = hole
        if use_temporal:
            job, tf = pending.pop(t)
            job.result()
            # nền thật ưu tiên trước, rồi mới tới khung đã lấp (ngoài ngân sách thử)
            if median_of > 1:
                if prev_out_band is not None:  # one more vote, inside the try budget
                    tf.feed([(prev_out_band, all_valid)])
            elif anchor is not None:
                src, valid, clean = anchor
                reused = tf.feed_previous(clean, src, valid)
            filled, remaining = tf.result()
            if remaining.sum() < hole.sum():
                n_temporal += 1
        if remaining.any():
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            remaining = cv2.dilate(remaining.astype(np.uint8), k).astype(bool) & hole
            filled = fill_in_frame(frame, filled, remaining)
            n_ai += 1
        if filler.requested == "propainter" and filler.lama is not None:
            # LaMa tinh chỉnh lại toàn vùng: nền thật giữ 65%, LaMa 35% để xóa vệt/ringing
            refined = fill_in_frame(frame, filled, hole)
            blend = (filled.astype(np.float32) * PROPAINTER_TEMPORAL_WEIGHT
                     + refined.astype(np.float32) * (1 - PROPAINTER_TEMPORAL_WEIGHT))
            filled = np.where(hole[..., None], np.clip(blend, 0, 255).astype(np.uint8), filled)
            n_ai += 1
        filled = _feather_blend(band, filled, hole)
        out = frame.copy()
        out[by0:by1] = filled
        prev_out_band = filled
        if not reused:
            anchor = (band, valids[t], filled)
        return out

    try:
        while True:
            # đọc trước Wn khung hình để có "tương lai" (+ `ahead` cho các luồng phụ)
            while not eof and read_idx <= out_idx + Wn + ahead:
                ok, fr = cap.read()
                if not ok:
                    eof = True
                    break
                frames.append((read_idx, fr))
                bands[read_idx] = fr[by0:by1].copy()
                holes[read_idx] = h = plan.hole(read_idx)
                valids[read_idx] = all_valid if h is None else ~h
                read_idx += 1
            # a frame's neighbour pass starts once its whole future window has been read
            while pool and queued < read_idx and (eof or queued + Wn < read_idx):
                queue_neighbours(queued)
                queued += 1
            if not frames:
                break
            t, fr = frames.popleft()
            writer.write(process(t, fr))
            out_idx = t + 1
            for old in [k for k in bands if k < t - Wn]:
                bands.pop(old, None)
                holes.pop(old, None)
                valids.pop(old, None)
            if progress and t % 15 == 0:
                progress(min(t / total, 1.0), f"Xóa phụ đề: khung {t}/{total}")
    finally:
        if pool:
            pool.shutdown(wait=True, cancel_futures=True)
        cap.release()
    writer.close()
    log(f"Xóa phụ đề xong: {n_temporal} khung dùng nền thật từ khung lân cận, {n_ai} khung cần AI/OpenCV lấp.")
    return out_path
