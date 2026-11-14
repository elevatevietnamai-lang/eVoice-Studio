"""The Vietnamese user guide (docs/huong-dan/) stays consistent with the app.

Every article passes scripts/docs/check_guides.py: complete front-matter, images that exist,
bold UI labels that exist in the Vietnamese catalog or the capture manifest, links to real
articles, and no personal data. Every article in the guide table has its screenshots.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "docs"))

from check_guides import check  # noqa: E402
from guides import GUIDES, GUIDES_DIR, manifest  # noqa: E402

ARTICLES = sorted(GUIDES_DIR.glob("*/index*.md"))


@pytest.mark.parametrize("article", ARTICLES, ids=lambda path: path.parent.name)
def test_article_passes_checks(article: Path) -> None:
    assert check(article) == []


@pytest.mark.parametrize("guide", GUIDES, ids=lambda guide: guide.slug)
def test_every_guide_has_screenshots(guide) -> None:
    data = manifest(guide.slug)
    assert data, f"{guide.slug}: run `bun run docs:capture {guide.slug}`"
    for step in data["steps"]:
        assert (GUIDES_DIR / guide.slug / step["file"]).is_file(), step["file"]
        assert (step["width"], step["height"]) == (1440, 900)


def test_check_rejects_unknown_label_and_missing_image() -> None:
    folder = GUIDES_DIR / "nhan-ban-giong"
    bad = folder / ".test-bad.md"
    bad.write_text(
        "---\ntitle: T\ndescription: D\nslug: nhan-ban-giong\norder: 2\ngroup: voice\n"
        "updated: 2026-11-14\napp_version: 0\nstatus: draft\n---\n\n"
        "Bấm **Nút Không Tồn Tại**.\n\n![ảnh](shots/khong-co.png)\n",
        encoding="utf-8",
    )
    try:
        problems = "\n".join(check(bad))
    finally:
        bad.unlink()
    assert "Nút Không Tồn Tại" in problems
    assert "khong-co.png" in problems
