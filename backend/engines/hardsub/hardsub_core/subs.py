"""Cấu trúc phụ đề, đọc/ghi SRT và ASS."""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict


@dataclass
class Segment:
    idx: int
    start: float
    end: float
    text: str
    boxes: list = field(default_factory=list)  # [[x1,y1,x2,y2], ...] toạ độ khung hình gốc

    def to_dict(self):
        return asdict(self)

    @staticmethod
    def from_dict(d):
        return Segment(int(d["idx"]), float(d["start"]), float(d["end"]), d["text"], d.get("boxes") or [])


def fmt_time(t: float, sep: str = ",") -> str:
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def parse_time(s: str) -> float:
    s = str(s).strip().replace(",", ".")
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(s)
    except ValueError:
        raise ValueError(f"Thời gian không hợp lệ: {s!r}")


def write_srt(path: str, segs: list[Segment], texts: list[str] | None = None):
    lines = []
    for i, seg in enumerate(segs, 1):
        txt = texts[i - 1] if texts else seg.text
        lines += [str(i), f"{fmt_time(seg.start)} --> {fmt_time(seg.end)}", txt.strip(), ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def read_srt(path: str) -> list[Segment]:
    raw = open(path, encoding="utf-8-sig").read()
    segs = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        rows = block.strip().splitlines()
        if len(rows) < 2:
            continue
        ti = 1 if "-->" in rows[1] else 0
        a, b = [x.strip() for x in rows[ti].split("-->")]
        segs.append(Segment(len(segs) + 1, parse_time(a), parse_time(b), "\n".join(rows[ti + 1:])))
    return segs


def _ass_escape(text: str) -> str:
    text = text.replace("\\", "＼").replace("{", "｛").replace("}", "｝")
    return text.strip().replace("\r", "").replace("\n", r"\N")


def write_ass(path: str, segs: list[Segment], texts: list[str], width: int, height: int,
              font: str, font_size: int, margin_v: int, outline: float,
              primary: str = "&H00FFFFFF", outline_color: str = "&H00000000",
              top_texts: list[str] | None = None, top_font: str | None = None):
    """Ghi file ASS. top_texts: dòng phụ (vd. song ngữ) hiển thị phía trên, cỡ nhỏ hơn."""
    ml = int(width * 0.05)
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{font},{font_size},{primary},&H000000FF,{outline_color},&H64000000,-1,0,0,0,100,100,0,0,1,{outline:.1f},0,2,{ml},{ml},{margin_v},1
Style: Top,{top_font or font},{int(font_size * 0.75)},&H00E0E0E0,&H000000FF,{outline_color},&H64000000,-1,0,0,0,100,100,0,0,1,{outline * 0.8:.1f},0,2,{ml},{ml},{margin_v + int(font_size * 1.35)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def at(t):  # ASS dùng h:mm:ss.cc
        cs = int(round(max(0.0, t) * 100))
        h, cs = divmod(cs, 360000)
        m, cs = divmod(cs, 6000)
        s, cs = divmod(cs, 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    rows = []
    for i, seg in enumerate(segs):
        if texts[i].strip():
            rows.append(f"Dialogue: 0,{at(seg.start)},{at(seg.end)},Main,,0,0,0,,{_ass_escape(texts[i])}")
        if top_texts and top_texts[i].strip():
            rows.append(f"Dialogue: 0,{at(seg.start)},{at(seg.end)},Top,,0,0,0,,{_ass_escape(top_texts[i])}")
    with open(path, "w", encoding="utf-8-sig") as f:
        f.write(head + "\n".join(rows) + "\n")
