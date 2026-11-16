"""Language tags for media containers (ISO 639-2)."""
from __future__ import annotations

import re

# ISO 639-1 → ISO 639-2/T (the terminology code MP4 asks for; ffmpeg's MP4
# muxer packs any three letters, but a two-letter "vi" becomes "und").
_ISO639_1_TO_2T = {
    "aa": "aar", "ab": "abk", "ae": "ave", "af": "afr", "ak": "aka", "am": "amh",
    "an": "arg", "ar": "ara", "as": "asm", "av": "ava", "ay": "aym", "az": "aze",
    "ba": "bak", "be": "bel", "bg": "bul", "bi": "bis", "bm": "bam", "bn": "ben",
    "bo": "bod", "br": "bre", "bs": "bos", "ca": "cat", "ce": "che", "ch": "cha",
    "co": "cos", "cr": "cre", "cs": "ces", "cu": "chu", "cv": "chv", "cy": "cym",
    "da": "dan", "de": "deu", "dv": "div", "dz": "dzo", "ee": "ewe", "el": "ell",
    "en": "eng", "eo": "epo", "es": "spa", "et": "est", "eu": "eus", "fa": "fas",
    "ff": "ful", "fi": "fin", "fj": "fij", "fo": "fao", "fr": "fra", "fy": "fry",
    "ga": "gle", "gd": "gla", "gl": "glg", "gn": "grn", "gu": "guj", "gv": "glv",
    "ha": "hau", "he": "heb", "hi": "hin", "ho": "hmo", "hr": "hrv", "ht": "hat",
    "hu": "hun", "hy": "hye", "hz": "her", "ia": "ina", "id": "ind", "ie": "ile",
    "ig": "ibo", "ii": "iii", "ik": "ipk", "io": "ido", "is": "isl", "it": "ita",
    "iu": "iku", "ja": "jpn", "jv": "jav", "ka": "kat", "kg": "kon", "ki": "kik",
    "kj": "kua", "kk": "kaz", "kl": "kal", "km": "khm", "kn": "kan", "ko": "kor",
    "kr": "kau", "ks": "kas", "ku": "kur", "kv": "kom", "kw": "cor", "ky": "kir",
    "la": "lat", "lb": "ltz", "lg": "lug", "li": "lim", "ln": "lin", "lo": "lao",
    "lt": "lit", "lu": "lub", "lv": "lav", "mg": "mlg", "mh": "mah", "mi": "mri",
    "mk": "mkd", "ml": "mal", "mn": "mon", "mr": "mar", "ms": "msa", "mt": "mlt",
    "my": "mya", "na": "nau", "nb": "nob", "nd": "nde", "ne": "nep", "ng": "ndo",
    "nl": "nld", "nn": "nno", "no": "nor", "nr": "nbl", "nv": "nav", "ny": "nya",
    "oc": "oci", "oj": "oji", "om": "orm", "or": "ori", "os": "oss", "pa": "pan",
    "pi": "pli", "pl": "pol", "ps": "pus", "pt": "por", "qu": "que", "rm": "roh",
    "rn": "run", "ro": "ron", "ru": "rus", "rw": "kin", "sa": "san", "sc": "srd",
    "sd": "snd", "se": "sme", "sg": "sag", "si": "sin", "sk": "slk", "sl": "slv",
    "sm": "smo", "sn": "sna", "so": "som", "sq": "sqi", "sr": "srp", "ss": "ssw",
    "st": "sot", "su": "sun", "sv": "swe", "sw": "swa", "ta": "tam", "te": "tel",
    "tg": "tgk", "th": "tha", "ti": "tir", "tk": "tuk", "tl": "tgl", "tn": "tsn",
    "to": "ton", "tr": "tur", "ts": "tso", "tt": "tat", "tw": "twi", "ty": "tah",
    "ug": "uig", "uk": "ukr", "ur": "urd", "uz": "uzb", "ve": "ven", "vi": "vie",
    "vo": "vol", "wa": "wln", "wo": "wol", "xh": "xho", "yi": "yid", "yo": "yor",
    "za": "zha", "zh": "zho", "zu": "zul",
    # Deprecated ISO 639-1 codes still seen in older data.
    "iw": "heb", "in": "ind", "ji": "yid", "jw": "jav", "mo": "ron",
}
# ISO 639-2/B → /T for the twenty languages whose codes differ.
_ISO639_2B_TO_2T = {
    "alb": "sqi", "arm": "hye", "baq": "eus", "bur": "mya", "chi": "zho",
    "cze": "ces", "dut": "nld", "fre": "fra", "geo": "kat", "ger": "deu",
    "gre": "ell", "ice": "isl", "mac": "mkd", "mao": "mri", "may": "msa",
    "per": "fas", "rum": "ron", "slo": "slk", "tib": "bod", "wel": "cym",
}
#: Language names some callers store instead of a code.
_NAMES = {
    "chinese": "zho", "mandarin": "zho", "cantonese": "yue", "english": "eng",
    "vietnamese": "vie", "japanese": "jpn", "korean": "kor",
}


def iso639_2(value: object) -> str:
    """The ISO 639-2/T code for a language tag, or ``"und"`` when unknown.

    Accepts ISO 639-1 ("vi"), BCP-47 with region or script ("zh-CN",
    "pt_BR"), three-letter ISO 639-2/3 codes ("vie", "yue", "fre" → "fra"),
    and a few language names. Container metadata takes this, never the raw
    two-letter code the app uses internally."""
    raw = str(value or "").strip().lower()
    if raw in _NAMES:
        return _NAMES[raw]
    base = re.split(r"[-_]", raw, maxsplit=1)[0]
    if len(base) == 2 and base in _ISO639_1_TO_2T:
        return _ISO639_1_TO_2T[base]
    if re.fullmatch(r"[a-z]{3}", base) and base not in ("und", "mul", "zxx"):
        return _ISO639_2B_TO_2T.get(base, base)
    return "und"
