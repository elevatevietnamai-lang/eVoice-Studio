"""Split long text into sentence-sized pieces for sentence-level MT models.

NLLB is trained on single sentences. Fed a long paragraph it drifts into a
loop ("khoa học" nineteen times in one Vietnamese segment). Translating each
sentence separately keeps every input inside what the model learned.
"""
from __future__ import annotations

import re

#: Text at or under this length goes to the model whole: one sentence, or a
#: short line the model handles well, and splitting it would only cost context.
MT_SPLIT_MIN_CHARS = 120
#: Longest piece sent to the model. Whisper's Chinese often has no sentence
#: punctuation, so a run without any boundary is cut at clause marks, then at
#: whitespace, then hard.
MT_PIECE_MAX_CHARS = 160

# Escaped, not literal: CJK punctuation is CJK text (tests/test_no_hardcoded_cjk.py).
# Sentence ends: ideographic full stop, fullwidth ! ? ; plus ASCII ! ? ; and the ellipsis.
_SENTENCE_END = re.compile(r"(?<=[\u3002\uff01\uff1f\uff1b!?;\u2026])|(?<=\.)(?=\s)")
# Clause marks: fullwidth comma, ideographic comma, fullwidth colon, ASCII , :
_CLAUSE_END = re.compile(r"(?<=[\uff0c\u3001\uff1a,:])")


def _cut(text: str, pattern: re.Pattern, max_chars: int) -> list[str]:
    """Greedily pack ``pattern``-delimited parts into pieces of ``max_chars``."""
    pieces: list[str] = []
    current = ""
    for part in pattern.split(text):
        if not part:
            continue
        if current and len(current) + len(part) > max_chars:
            pieces.append(current)
            current = part
        else:
            current += part
    if current:
        pieces.append(current)
    return pieces


def _hard_cut(text: str, max_chars: int) -> list[str]:
    pieces = _cut(text, _CLAUSE_END, max_chars)
    out: list[str] = []
    for piece in pieces:
        if len(piece) <= max_chars:
            out.append(piece)
            continue
        words = _cut(piece, re.compile(r"(?<=\s)"), max_chars)
        for word_piece in words:
            while len(word_piece) > max_chars:
                out.append(word_piece[:max_chars])
                word_piece = word_piece[max_chars:]
            if word_piece:
                out.append(word_piece)
    return out


# Hiragana/katakana, CJK ext. A, CJK unified, Hangul syllables, compatibility ideographs.
_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]")


def _mostly_cjk(text: str) -> bool:
    letters = [ch for ch in text if ch.isalpha()]
    return bool(letters) and sum(1 for ch in letters if _CJK.match(ch)) * 2 > len(letters)


def split_for_mt(
    text: str,
    *,
    min_chars: int = MT_SPLIT_MIN_CHARS,
    max_chars: int = MT_PIECE_MAX_CHARS,
) -> list[str]:
    """Sentence pieces of ``text``, in order; ``[text]`` when it is short.

    Joining the pieces with :func:`join_mt_pieces` restores the text up to
    whitespace between pieces. Empty pieces are never returned."""
    stripped = (text or "").strip()
    if _mostly_cjk(stripped):
        # A Han/kana/Hangul character carries about a word: a 40-character
        # Chinese line is already a long sentence for the model.
        min_chars, max_chars = min_chars // 3, max_chars // 3
    if len(stripped) <= min_chars:
        return [text]
    pieces: list[str] = []
    for sentence in _cut(stripped, _SENTENCE_END, max_chars):
        if len(sentence) <= max_chars:
            pieces.append(sentence)
        else:
            pieces.extend(_hard_cut(sentence, max_chars))
    pieces = [piece.strip() for piece in pieces if piece.strip()]
    return pieces or [text]


#: FLORES script tags written without spaces between sentences.
_UNSPACED_TARGETS = ("zho_", "yue_", "jpn_")


def join_mt_pieces(pieces: list[str], flores_target: str) -> str:
    """Rejoin translated pieces; no separator for Chinese/Japanese targets."""
    separator = "" if flores_target.startswith(_UNSPACED_TARGETS) else " "
    return separator.join(piece.strip() for piece in pieces if piece and piece.strip())
