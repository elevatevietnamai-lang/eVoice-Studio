"""Bundled font for burned-in subtitles.

libass picks fonts through each OS's own provider (DirectWrite, CoreText,
fontconfig), so a script asking for "Arial" drew Arial on Windows and macOS
but whatever fontconfig substituted on Linux. Burned captions now name one
family that ships with the backend (``backend/assets/fonts``, Inter, SIL OFL
1.1) and every burn passes that folder to libass as ``fontsdir``, so Latin,
Greek, Cyrillic and Vietnamese text renders the same on every platform.
Scripts Inter does not cover (CJK, Arabic, Devanagari, Thai, ...) still use
the OS fallback font.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

#: Family name inside InterVariable.ttf (name ID 1). libass matches on it.
BURN_FONT_FAMILY = "Inter Variable"

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_FONT_FILE = "InterVariable.ttf"


def burn_fonts_dir() -> Optional[str]:
    """The bundled font folder, or None when the font file is missing."""
    return str(_FONTS_DIR) if (_FONTS_DIR / _FONT_FILE).is_file() else None
