#!/usr/bin/env python
"""Validate Vietnamese user guide articles under docs/huong-dan/<slug>/.

Checks performed on every index.md (and index.next.md when present):
1. Front-matter includes all REQUIRED_FRONT_MATTER keys, slug matches the folder
   name and exists in GUIDES, status is 'draft' or 'approved', and description
   is at most 155 characters.
2. Every Markdown image ![alt](path) has non-empty alt text and resolves to an
   existing file relative to the article folder.
3. Every bold span **...** outside HTML comments and code spans matches a known
   Vietnamese UI string from locale("vi"), a label from the guide's capture
   manifest (headings, buttons, links, fields, highlight), or a menu/group label
   after normalisation (also allowing trailing parentheticals or 'A: B' prefixes).
4. Relative guide links ](../<slug>/) point to slugs defined in GUIDES.
5. No personal data appears: email addresses (except @example.com), Hugging Face
   tokens (hf_ + 10+ alphanumerics), Windows user paths X:\\Users\\<name> where
   <name> is not 'demo', or phone-like numbers (0 followed by 9-10 digits).
6. Counts <!-- TODO markers per file and prints a summary line 'TODO: <slug> (n)'
   without treating TODOs as errors.
"""
from __future__ import annotations

import argparse
import re
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from guides import (  # noqa: E402
    BY_SLUG,
    GROUPS,
    GUIDES,
    GUIDES_DIR,
    REQUIRED_FRONT_MATTER,
    ROOT,
    locale,
    manifest,
    split_front_matter,
)

FENCE = "`" * 3
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
FENCE_RE = re.compile(rf"{FENCE}.*?{FENCE}", re.S)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
BOLD_RE = re.compile(r"\*\*([^*\n]+?)\*\*")
LOCAL_LINK_RE = re.compile(r"\]\(((?:file:|[A-Za-z]:[\\/]|/)[^)]*)\)")
REL_GUIDE_LINK_RE = re.compile(r"\]\(\.\./([^/)\s#?]+)/?(?:[#?][^)]*)?\)")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")
HF_TOKEN_RE = re.compile(r"\bhf_[A-Za-z0-9]{10,}\b")
WIN_USER_RE = re.compile(r"\b[A-Za-z]:\\Users\\([^\\\s\"'`/]+)")
PHONE_RE = re.compile(r"(?<!\d)0\d{9,10}(?!\d)")
TODO_RE = re.compile(r"<!--\s*TODO\b")

MENU_LABELS = {
    "Menu",
    "Tệp",
    "File",
    "Chỉnh sửa",
    "Edit",
    "Xem",
    "View",
    "Cửa sổ",
    "Window",
    "Trợ giúp",
    "Help",
    "eVoice Studio",
    *GROUPS.values(),
    *(g.title for g in GUIDES),
}


def normalise(text: str) -> str:
    s = text.strip()
    while len(s) >= 2 and s[0] in "\"'“”‘’" and s[-1] in "\"'“”‘’":
        s = s[1:-1].strip()
    s = re.sub(r"(?:\.\.\.|[:：….])+\s*$", "", s).strip()
    while len(s) >= 2 and s[0] in "\"'“”‘’" and s[-1] in "\"'“”‘’":
        s = s[1:-1].strip()
    return s


@lru_cache(maxsize=1)
def base_ui_labels() -> frozenset[str]:
    out: set[str] = set()
    for val in (*locale("vi").values(), *MENU_LABELS):
        if isinstance(val, str) and val.strip():
            out.add(val.strip())
            norm = normalise(val)
            if norm:
                out.add(norm)
    return frozenset(out)


def allowed_labels(slug: str, folder: Path | None = None) -> set[str]:
    labels = set(base_ui_labels())
    data = manifest(slug)
    if data is None and folder is not None:
        local_manifest = folder / "manifest.json"
        if local_manifest.is_file():
            import json

            data = json.loads(local_manifest.read_text(encoding="utf-8"))
    if not data:
        return labels
    if isinstance(data.get("title"), str):
        labels.add(data["title"].strip())
        labels.add(normalise(data["title"]))
    for step in data.get("steps", ()):
        if isinstance(step.get("highlight"), str) and step["highlight"].strip():
            labels.add(step["highlight"].strip())
            labels.add(normalise(step["highlight"]))
        step_labels = step.get("labels") or {}
        if isinstance(step_labels.get("title"), str):
            labels.add(step_labels["title"].strip())
            labels.add(normalise(step_labels["title"]))
        for group in ("headings", "buttons", "links", "fields"):
            for item in step_labels.get(group, ()):
                if isinstance(item, str) and item.strip():
                    labels.add(item.strip())
                    norm = normalise(item)
                    if norm:
                        labels.add(norm)
    return labels


def is_valid_label(raw: str, known: set[str]) -> bool:
    norm = normalise(raw)
    if not norm:
        return False
    no_paren = normalise(re.sub(r"\s*\([^)]*\)", "", norm))
    candidates = {raw.strip(), norm, no_paren}
    for sep in (":", "："):
        if sep in norm:
            prefix = normalise(norm.split(sep, 1)[0])
            candidates.add(prefix)
            candidates.add(normalise(re.sub(r"\s*\([^)]*\)", "", prefix)))
    return any(c and c in known for c in candidates)


def _mask_keep_newlines(text: str) -> str:
    def blank(match: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", match.group(0))

    masked = COMMENT_RE.sub(blank, text)
    masked = FENCE_RE.sub(blank, masked)
    return INLINE_CODE_RE.sub(blank, masked)


def _rel_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def count_todos(path: Path) -> int:
    return len(TODO_RE.findall(path.read_text(encoding="utf-8")))


def check(path: Path) -> list[str]:
    rel = _rel_path(path)
    raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    errors: list[str] = []
    folder_slug = path.parent.name

    meta, _ = split_front_matter(raw)
    if not meta:
        errors.append(f"{rel}:1: missing front-matter")
    else:
        missing = [key for key in REQUIRED_FRONT_MATTER if not meta.get(key)]
        if missing:
            errors.append(f"{rel}:1: missing front-matter key(s): {', '.join(missing)}")
        slug = meta.get("slug", "")
        if slug != folder_slug:
            errors.append(f"{rel}:1: front-matter slug '{slug}' does not match folder '{folder_slug}'")
        if slug not in BY_SLUG:
            errors.append(f"{rel}:1: slug '{slug}' is not in GUIDES")
        status = meta.get("status", "")
        if status not in ("draft", "approved"):
            errors.append(f"{rel}:1: invalid status '{status}' (expected 'draft' or 'approved')")
        description = meta.get("description", "")
        if len(description) > 155:
            errors.append(f"{rel}:1: description is {len(description)} chars (max 155)")

    fm_match = re.match(r"\A---\n.*?\n---\n", raw, re.S)
    body_start_line = raw[: fm_match.end()].count("\n") + 1 if fm_match else 1
    masked = _mask_keep_newlines(raw)
    known_labels = allowed_labels(folder_slug, path.parent)

    for lineno, (raw_line, masked_line) in enumerate(
        zip(raw.splitlines(), masked.splitlines()), start=1
    ):
        if lineno >= body_start_line:
            for match in IMAGE_RE.finditer(masked_line):
                alt, target = match.group(1).strip(), match.group(2).strip()
                if not alt:
                    errors.append(f"{rel}:{lineno}: empty alt text for image '{target}'")
                if not (path.parent / target).is_file():
                    errors.append(f"{rel}:{lineno}: missing image file '{target}'")

            for match in BOLD_RE.finditer(masked_line):
                label = match.group(1)
                if not is_valid_label(label, known_labels):
                    errors.append(f'{rel}:{lineno}: unknown UI label "{label}"')

            for match in REL_GUIDE_LINK_RE.finditer(masked_line):
                target_slug = match.group(1)
                if target_slug not in BY_SLUG:
                    errors.append(f"{rel}:{lineno}: link to unknown guide slug '{target_slug}'")

            # The writer has produced file:/// links to local paths; only web and relative links may ship.
            for match in LOCAL_LINK_RE.finditer(masked_line):
                errors.append(f"{rel}:{lineno}: local or absolute link '{match.group(1)[:60]}'")

        for match in EMAIL_RE.finditer(raw_line):
            if match.group(1).lower() != "example.com":
                errors.append(f"{rel}:{lineno}: personal data (email '{match.group(0)}')")
        for match in HF_TOKEN_RE.finditer(raw_line):
            errors.append(f"{rel}:{lineno}: personal data (HF token '{match.group(0)}')")
        for match in WIN_USER_RE.finditer(raw_line):
            if match.group(1).lower() != "demo":
                errors.append(f"{rel}:{lineno}: personal data (Windows path '{match.group(0)}')")
        for match in PHONE_RE.finditer(raw_line):
            errors.append(f"{rel}:{lineno}: personal data (phone number '{match.group(0)}')")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slugs", nargs="*", help="Guide slugs to check (default: all in GUIDES)")
    args = parser.parse_args(argv)

    unknown = [slug for slug in args.slugs if slug not in BY_SLUG]
    if unknown:
        parser.error(f"unknown slug(s): {', '.join(unknown)}")

    slugs = args.slugs or [g.slug for g in GUIDES]
    all_errors: list[str] = []
    checked = 0

    for slug in slugs:
        folder = GUIDES_DIR / slug
        files = [folder / "index.md"]
        next_file = folder / "index.next.md"
        if next_file.exists():
            files.append(next_file)
        for md_path in files:
            if not md_path.exists():
                continue
            checked += 1
            all_errors.extend(check(md_path))
            todos = count_todos(md_path)
            if todos:
                print(f"TODO: {slug} ({todos})")

    if all_errors:
        for err in all_errors:
            print(err)
        return 1

    print(f"{checked} guides OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
