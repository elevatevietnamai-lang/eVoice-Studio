#!/usr/bin/env python
"""Bulk-translate renderer locale strings with the Antigravity CLI (`agy`), review them, then apply.

The renderer catalogs (electron/src/renderer/src/i18n/locales/*.json) fall back to English for
strings nobody translated yet. This script finds, for each non-English locale, the keys that

  * are still identical to English in that locale, and
  * were genuinely translated in vi.json (so brand names, units and key combos that stay
    English everywhere are left alone),

and runs three separate, resumable steps. Nothing touches a locale file until `apply`:

  translate  agy --model <translator>  -> <staging>/<locale>.translated.json
  review     agy --model <reviewer>    -> <staging>/<locale>.reviewed.json   (ok / fix per key)
  apply      validated result          -> locales/<locale>.json

Every model answer is validated before it is kept: same keys, same {{placeholders}}, no empty
text, no leaked markup. Strings that fail are retried once, then reported and skipped.

    uv run python scripts/i18n_translate_agy.py plan
    uv run python scripts/i18n_translate_agy.py translate --locales de fr
    uv run python scripts/i18n_translate_agy.py review    --locales de fr
    uv run python scripts/i18n_translate_agy.py apply     --locales de fr

`agy` runs read-only (`--mode plan`) and never gets permission to use tools; the prompts only
contain UI strings, no user data. List models with `agy models`.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "electron" / "src" / "renderer" / "src" / "i18n" / "locales"
DEFAULT_STAGING = ROOT.parent / "i18n_staging"
TRANSLATOR = "gemini-4-argon-medium"
REVIEWER = "claude-opus-5-5-medium"

LANGUAGES = {
    "ar": "Arabic (العربية)", "de": "German (Deutsch)", "es": "Spanish (Español)",
    "fr": "French (Français)", "hi": "Hindi (हिन्दी)", "id": "Indonesian (Bahasa Indonesia)",
    "it": "Italian (Italiano)", "ja": "Japanese (日本語)", "ko": "Korean (한국어)",
    "nl": "Dutch (Nederlands)", "pl": "Polish (Polski)", "pt": "Portuguese (Português)",
    "ru": "Russian (Русский)", "sv": "Swedish (Svenska)", "th": "Thai (ไทย)",
    "tr": "Turkish (Türkçe)", "uk": "Ukrainian (Українська)",
    "zh-CN": "Simplified Chinese (简体中文)", "zh-TW": "Traditional Chinese (繁體中文)",
}
PLACEHOLDER = re.compile(r"\{\{[^}]*\}\}")
NO_TOOLS = "IMPORTANT: Answer directly from your own knowledge. Do NOT use any tool, command, file or web access.\n"
GLOSSARY = (
    "Keep these unchanged: VoiceStudio, ACE-Step, LaMa, STTN, ProPainter, OpenCV, RapidOCR, YouTube, "
    "Twilio, HuggingFace, ffmpeg, file formats (MP4, WAV, SRT...), key combos (Ctrl/Cmd+K), units "
    "(MB, GB, ms, bpm, BPM). 'Dub'/'dubbing' means re-voicing a video in another language. "
    "'Engine' is a software component that runs a model."
)


# ───────────────────────────────────────────────────────────── catalog helpers

def flat(d: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        out.update(flat(v, key) if isinstance(v, dict) else {key: v})
    return out


def read_locale(code: str) -> tuple[dict, str]:
    raw = (LOCALES / f"{code}.json").read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    return json.loads(raw.replace("\r\n", "\n")), newline


def set_key(tree: dict, dotted: str, value: str) -> None:
    node = tree
    parts = dotted.split(".")
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


def todo_for(code: str) -> dict[str, str]:
    en = flat(read_locale("en")[0])
    vi = flat(read_locale("vi")[0])
    loc = flat(read_locale(code)[0])
    return {k: en[k] for k in en
            if isinstance(en[k], str) and vi.get(k) != en[k] and loc.get(k) == en[k]
            and re.search(r"[A-Za-z]{2,}", en[k])}


# ───────────────────────────────────────────────────────────── agy + validation

def run_agy(prompt: str, model: str, timeout: int = 600) -> str:
    proc = subprocess.run(["agy", "--mode", "plan", "--model", model, "-p", NO_TOOLS + prompt],
                          capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if proc.returncode != 0 or "permission" in proc.stderr.lower() and not proc.stdout.strip():
        raise RuntimeError(f"agy failed ({proc.returncode}): {proc.stderr.strip()[:300]}")
    return proc.stdout


def extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("no JSON object in the answer")
    return json.loads(match.group(0))


def placeholders(text: str) -> list[str]:
    return sorted(PLACEHOLDER.findall(text))


def validate(src: dict[str, str], out: dict) -> tuple[dict[str, str], dict[str, str]]:
    """Return (accepted, rejected_reason) for one batch."""
    good: dict[str, str] = {}
    bad: dict[str, str] = {}
    for key, source in src.items():
        value = out.get(key)
        if not isinstance(value, str) or not value.strip():
            bad[key] = "missing or empty"
        elif placeholders(value) != placeholders(source):
            bad[key] = "placeholders changed"
        elif re.search(r"```|^\s*\{|</?[a-z]+>", value) and not re.search(r"</?[a-z]+>", source):
            bad[key] = "markup leaked in"
        elif ("\n" in source) != ("\n" in value):
            bad[key] = "line breaks changed"
        else:
            good[key] = value.strip() if "\n" not in source else value
    return good, bad


def batches(items: dict[str, str], size: int):
    keys = list(items)
    for i in range(0, len(keys), size):
        yield {k: items[k] for k in keys[i:i + size]}


# ───────────────────────────────────────────────────────────── steps

def translate_prompt(code: str, batch: dict[str, str]) -> str:
    return (
        f"You are a professional software localizer. Translate these UI strings of a desktop voice-dubbing "
        f"app from English to {LANGUAGES[code]}.\n"
        f"Rules: keep every {{{{placeholder}}}} exactly as written; keep \\n line breaks; be concise (buttons and "
        f"table headers are narrow); use the natural, standard term a native user expects; the key name shows "
        f"the context (keys ending _one/_other/_few/_many are plural forms of the same sentence).\n"
        f"{GLOSSARY}\n"
        f"Return ONLY a JSON object mapping each key to its translation, same keys, no commentary.\n\n"
        + json.dumps(batch, ensure_ascii=False, indent=1))


def review_prompt(code: str, pairs: dict[str, dict[str, str]]) -> str:
    return (
        f"You are a native {LANGUAGES[code]} localization reviewer for a desktop voice-dubbing app. Below, each key "
        f"has the English source and a machine translation. Check meaning, natural phrasing, consistency, brevity "
        f"for a narrow UI, and that every {{{{placeholder}}}} is intact. {GLOSSARY}\n"
        f"Return ONLY a JSON object: for every key either {{\"ok\": true}} or {{\"fix\": \"<corrected translation>\"}}. "
        f"Fix only real errors (wrong meaning, unnatural, wrong register); do not rewrite acceptable text.\n\n"
        + json.dumps(pairs, ensure_ascii=False, indent=1))


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def do_translate(code: str, staging: Path, size: int, model: str) -> str:
    path = staging / f"{code}.translated.json"
    done = load(path)
    todo = {k: v for k, v in todo_for(code).items() if k not in done}
    rejected: dict[str, str] = {}
    for batch in batches(todo, size):
        for attempt in (1, 2):
            try:
                good, bad = validate(batch, extract_json(run_agy(translate_prompt(code, batch), model)))
            except Exception as exc:  # network, parse, agy error
                good, bad = {}, {k: f"error: {exc}"[:120] for k in batch}
            done.update(good)
            save(path, done)
            batch = {k: v for k, v in batch.items() if k in bad}
            rejected = {**{k: r for k, r in rejected.items() if k in batch}, **bad} if batch else {}
            if not batch:
                break
    return f"{code}: translated {len(done)} (skipped {len(rejected)}: {sorted(rejected)[:3]})"


def do_review(code: str, staging: Path, size: int, model: str) -> str:
    translated = load(staging / f"{code}.translated.json")
    path = staging / f"{code}.reviewed.json"
    reviewed = load(path)
    en = flat(read_locale("en")[0])
    todo = {k: v for k, v in translated.items() if k not in reviewed}
    for batch in batches(todo, size):
        pairs = {k: {"en": en[k], "tr": v} for k, v in batch.items()}
        try:
            verdicts = extract_json(run_agy(review_prompt(code, pairs), model))
        except Exception as exc:
            print(f"{code}: review batch failed: {exc}", file=sys.stderr)
            continue
        for key, verdict in verdicts.items():
            if key not in batch or not isinstance(verdict, dict):
                continue
            if verdict.get("ok") is True:
                reviewed[key] = batch[key]
            elif isinstance(verdict.get("fix"), str):
                good, _ = validate({key: en[key]}, {key: verdict["fix"]})
                if good:  # a fix that breaks placeholders is dropped, the original stays unreviewed
                    reviewed[key] = good[key]
        save(path, reviewed)
    fixed = sum(1 for k, v in reviewed.items() if translated.get(k) != v)
    return f"{code}: reviewed {len(reviewed)}/{len(translated)} (reviewer changed {fixed})"


def do_export(code: str, staging: Path) -> str:
    """Write the not-yet-reviewed pairs for a reviewer that is not `agy` (e.g. a subagent)."""
    translated = load(staging / f"{code}.translated.json")
    reviewed = load(staging / f"{code}.reviewed.json")
    en = flat(read_locale("en")[0])
    pairs = {k: {"en": en[k], "tr": v} for k, v in translated.items() if k not in reviewed}
    save(staging / f"{code}.to_review.json", pairs)
    return f"{code}: {len(pairs)} strings exported to {code}.to_review.json"


def do_merge(code: str, staging: Path) -> str:
    """Merge verdicts written to <code>.external_review.json ({key: {ok|fix}}) into reviewed.json."""
    translated = load(staging / f"{code}.translated.json")
    verdicts = load(staging / f"{code}.external_review.json")
    path = staging / f"{code}.reviewed.json"
    reviewed = load(path)
    en = flat(read_locale("en")[0])
    for key, verdict in verdicts.items():
        if key not in translated or not isinstance(verdict, dict):
            continue
        if verdict.get("ok") is True:
            reviewed[key] = translated[key]
        elif isinstance(verdict.get("fix"), str):
            good, _ = validate({key: en[key]}, {key: verdict["fix"]})
            if good:
                reviewed[key] = good[key]
    save(path, reviewed)
    return f"{code}: reviewed {len(reviewed)}/{len(translated)} after merge"


def do_apply(code: str, staging: Path) -> str:
    reviewed = load(staging / f"{code}.reviewed.json")
    en = flat(read_locale("en")[0])
    good, bad = validate({k: en[k] for k in reviewed}, reviewed)
    tree, newline = read_locale(code)
    for key, value in good.items():
        set_key(tree, key, value)
    text = json.dumps(tree, ensure_ascii=False, indent=2) + "\n"
    (LOCALES / f"{code}.json").write_text(text.replace("\n", newline), encoding="utf-8", newline="")
    return f"{code}: applied {len(good)} strings (rejected {len(bad)})"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["plan", "translate", "review", "export", "merge", "apply"])
    ap.add_argument("--locales", nargs="*", default=sorted(LANGUAGES))
    ap.add_argument("--staging", type=Path, default=DEFAULT_STAGING)
    ap.add_argument("--batch", type=int, default=50)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--translator", default=TRANSLATOR)
    ap.add_argument("--reviewer", default=REVIEWER)
    args = ap.parse_args()
    unknown = [c for c in args.locales if c not in LANGUAGES]
    if unknown:
        ap.error(f"unknown locales: {unknown}")

    if args.step == "plan":
        total = 0
        for code in args.locales:
            n = len(todo_for(code))
            total += n
            print(f"{code}: {n} strings to translate")
        print(f"total {total} -> about {-(-total // args.batch)} translate + as many review calls")
        return 0
    if args.step in ("apply", "export", "merge"):
        action = {"apply": do_apply, "export": do_export, "merge": do_merge}[args.step]
        for code in args.locales:
            print(action(code, args.staging))
        return 0
    job = (lambda c: do_translate(c, args.staging, args.batch, args.translator)) if args.step == "translate" \
        else (lambda c: do_review(c, args.staging, args.batch, args.reviewer))
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for line in pool.map(job, args.locales):
            print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
