#!/usr/bin/env python3
# /// script
# dependencies = ["pillow>=12.1.0", "resvg-py==0.5.0"]
# ///
"""Regenerate every raster brand icon from the canonical docs/logo.svg.

Run after changing the mark: uv run scripts/render_brand_icons.py
resvg rasterizes the SVGs on any OS. Sizes of 32 px and below use
docs/logo-small.svg, whose bars fill more of the tile so they stay readable.
The macOS ICNS puts the tile on Apple's 824 px grid inside a 1024 px canvas; it
uses iconutil on macOS and Pillow's ICNS writer elsewhere.
"""
import io
import pathlib
import shutil
import subprocess
import sys
import tempfile

import resvg_py
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/logo.svg"
SMALL = ROOT / "docs/logo-small.svg"
ICONS = ROOT / "electron/build/icons"
ICO_SIZES = [16, 24, 32, 48, 64, 256]
RECORDING = (0xEF, 0x44, 0x44, 255)
MAC_TILE = 824


def rasterize(svg, size=1024):
    png = resvg_py.svg_to_bytes(svg_string=svg.read_text(encoding="utf-8"), width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def scaled(master, small, size):
    return (small if size <= 32 else master).resize((size, size), Image.LANCZOS)


def recording(small):
    # The tray shows capture state with a red dot over the mark's lower right.
    icon = small.resize((128, 128), Image.LANCZOS)
    ImageDraw.Draw(icon).ellipse((40, 40, 124, 124), fill=RECORDING, outline=(255, 255, 255, 255), width=6)
    return icon.resize((32, 32), Image.LANCZOS)


def mac_master():
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    inset = (1024 - MAC_TILE) // 2
    canvas.paste(rasterize(SOURCE, MAC_TILE), (inset, inset))
    return canvas


def icns(work, target):
    mac = mac_master()
    if sys.platform == "darwin" and shutil.which("iconutil"):
        iconset = work / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            mac.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
            mac.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(target)], check=True)
    else:
        mac.save(target, format="ICNS")


def main():
    master = rasterize(SOURCE)
    small = rasterize(SMALL)
    scaled(master, small, 512).save(ROOT / "docs/logo.png")
    scaled(master, small, 256).save(ROOT / "docs/logo-256.png")
    scaled(master, small, 512).save(ICONS / "icon.png")
    scaled(master, small, 32).save(ICONS / "32x32.png")
    recording(small).save(ICONS / "tray-recording.png")
    frames = [scaled(master, small, size) for size in sorted(ICO_SIZES, reverse=True)]
    frames[0].save(ICONS / "icon.ico", sizes=[frame.size for frame in frames], append_images=frames[1:])
    with tempfile.TemporaryDirectory() as tmp:
        icns(pathlib.Path(tmp), ICONS / "icon.icns")


if __name__ == "__main__":
    main()
