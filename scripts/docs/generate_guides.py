#!/usr/bin/env python
"""Draft the Vietnamese user guide with the Antigravity CLI (`agy`, Gemini 4 Argon).

For each article in guides.py this writes a brief (writing rules, an en→vi glossary generated from
the renderer catalogs, the outline, the capture manifest), then runs `agy --mode plan` (read-only)
and asks it to read the brief, the screenshots, the listed docs and page code, and print the
article. The answer becomes docs/huong-dan/<slug>/index.md with `status: draft`. An article a
reviewer already marked `status: approved` is never overwritten: the new draft goes to
index.next.md instead.

    uv run python scripts/docs/generate_guides.py                 # every article with screenshots
    uv run python scripts/docs/generate_guides.py nhan-ban-giong  # only these slugs
    uv run python scripts/docs/generate_guides.py --jobs 4 --model gemini-4-argon-medium

Run `bun run docs:capture` first. Prompts carry UI strings, docs and code only, no user data.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_guides import check  # noqa: E402
from guides import BY_SLUG, GROUPS, GUIDES, GUIDES_DIR, ROOT, Guide, locale, manifest, split_front_matter  # noqa: E402

MODEL = "gemini-4-argon-medium"
STAGING = ROOT / ".docs-staging"
APP_VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]

RULES = """\
# Quy tắc viết

- Viết tiếng Việt tự nhiên như một người hướng dẫn thân thiện. Xưng "bạn", câu ngắn, giọng chủ động.
- Mỗi bước bắt đầu bằng động từ: "Bấm…", "Chọn…", "Kéo…", "Nhập…".
- Tên nút, menu, nhãn trên giao diện phải **giống hệt** chữ trong ảnh, bảng thuật ngữ hoặc manifest, và đặt
  trong `**…**`. Không tự dịch lại, không bịa nút. Chỉ in đậm tên nút/nhãn giao diện; không in đậm từ nào khác.
- Chỉ mô tả những gì thấy trong ảnh, manifest, tài liệu hoặc code được cung cấp. Chỗ nào không chắc thì
  ghi `<!-- TODO: kiểm tra -->` trên một dòng riêng, không đoán.
- Không văn quảng cáo, không mẫu câu sáo rỗng ("không chỉ… mà còn…", "hãy cùng khám phá", "tuyệt vời").
- Giữ nguyên thuật ngữ quen dùng: GPU, CPU, model, engine, timeline, hardsub, MCP, API, Hugging Face.
- App chạy hoàn toàn trên máy người dùng; chỉ nói tới kết nối mạng khi tính năng thật sự cần và người dùng bật.
- Không nhắc tên người, email, đường dẫn cá nhân.

# Khung bài (Markdown)

Bắt đầu ngay bằng front-matter, không có lời dẫn nào trước nó, không bọc trong ``` :

---
title: <tiêu đề bài>
description: <một câu ≤ 155 ký tự cho SEO>
slug: <slug>
order: <số>
group: <nhóm>
updated: <ngày>
app_version: <phiên bản>
status: draft
---

Sau đó các mục `##` theo thứ tự:
1. `## Tính năng này làm gì` (2–3 câu)
2. `## Cần chuẩn bị`
3. `## Các bước` — các bước đánh số `### 1. …`; mỗi ảnh chèn đúng một lần bằng
   `![mô tả alt tiếng Việt](shots/<id>.png)` với `<id>` có trong manifest. Dùng hết các ảnh, theo thứ tự.
   Bước nào trong dàn ý không có ảnh thì vẫn viết, không chèn ảnh.
4. `## Mẹo`
5. `## Lỗi thường gặp` — mỗi lỗi một gạch đầu dòng: triệu chứng viết chữ thường (không in đậm), rồi cách xử lý.
   Chỉ in đậm tên nút/nhãn nằm trong câu, không in đậm cả câu, không đặt `code` bên trong `**…**`.
6. `## Bài liên quan` — liên kết dạng `[Tên bài](../<slug>/)` chỉ tới các slug trong danh sách bài.
"""


def glossary(guide: Guide) -> str:
    en, vi = locale("en"), locale("vi")
    prefixes = tuple(f"{ns}." for ns in (*guide.namespaces, "nav", "common"))
    rows = [f"- {en[key]} → {vi[key]}" for key in en
            if key.startswith(prefixes) and key in vi and vi[key] != en[key]
            and len(en[key]) <= 80 and "{{" not in en[key]]
    return "\n".join(rows[:400])


def brief(guide: Guide, data: dict) -> str:
    shots_dir = GUIDES_DIR / guide.slug / "shots"
    steps = []
    for step in data["steps"]:
        labels = step["labels"]
        steps.append(
            f"### Ảnh `{step['id']}` — {step.get('caption') or ''}\n"
            f"- File: {(shots_dir / (step['id'] + '.png')).as_posix()}\n"
            f"- Route: {step['route']}\n"
            + (f"- Khung cam đánh dấu: **{step['highlight']}**\n" if step.get("highlight") else "")
            + f"- Tiêu đề: {', '.join(labels['headings'][:25])}\n"
            f"- Nút: {', '.join(labels['buttons'][:60])}\n"
            f"- Trường nhập: {', '.join(labels['fields'][:30])}\n"
        )
    others = ", ".join(f"{g.slug} ({g.title})" for g in GUIDES)
    sources = "\n".join(f"- {(ROOT / path).as_posix()}" for path in (*guide.sources, *guide.code)
                        if (ROOT / path).exists())
    return f"""# Nhiệm vụ

Viết bài hướng dẫn **{guide.title}** cho eVoice Studio (app desktop lồng tiếng, nhân bản giọng, chạy cục bộ).

Front-matter: slug `{guide.slug}`, order {guide.order}, group `{guide.group}` ({GROUPS[guide.group]}),
updated {dt.date.today().isoformat()}, app_version {APP_VERSION}, status draft.

## Dàn ý

{guide.outline}

## Ảnh chụp (mở từng file bằng công cụ xem ảnh trước khi viết)

{chr(10).join(steps)}

## Tài liệu và code để lấy dữ kiện (tiếng Anh; chỉ lấy dữ kiện, không dịch nguyên văn)

{sources or '- (không có)'}

## Các bài khác (dùng cho mục Bài liên quan)

{others}

{RULES}

# Bảng thuật ngữ giao diện (en → vi, đúng như trong app)

{glossary(guide)}
"""


def run_agy(guide: Guide, model: str) -> str:
    article = ask_agy(guide, model)
    problems = check_text(guide, article)
    if problems:  # one retry with the checker's findings
        article = ask_agy(guide, model, "; ".join(problems))
    return article


def check_text(guide: Guide, article: str) -> list[str]:
    draft = GUIDES_DIR / guide.slug / ".draft-check.md"
    draft.write_text(article, encoding="utf-8", newline="\n")
    try:
        return [problem.split(": ", 1)[-1] for problem in check(draft)]
    finally:
        draft.unlink()


def ask_agy(guide: Guide, model: str, problems: str = "") -> str:
    data = manifest(guide.slug)
    if not data:
        raise RuntimeError("no manifest.json; run `bun run docs:capture` first")
    STAGING.mkdir(exist_ok=True)
    brief_path = STAGING / f"{guide.slug}.md"
    brief_path.write_text(brief(guide, data), encoding="utf-8")
    prompt = (f"Read the file {brief_path.as_posix()} with your file tool and follow it exactly. "
              "Open every screenshot and source file it lists. Do not edit any file. "
              "Print only the finished Markdown article, starting with its front-matter line ---.")
    if problems:
        prompt += (" A previous draft failed these checks; avoid them (bold only exact UI labels): "
                   + problems[:3000])
    proc = subprocess.run(
        ["agy", "--mode", "plan", "--model", model, "--add-dir", str(ROOT), "-p", prompt],
        capture_output=True, text=True, encoding="utf-8", timeout=1800, stdin=subprocess.DEVNULL, cwd=ROOT)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(f"agy failed ({proc.returncode}): {proc.stderr.strip()[:300]}")
    return clean(proc.stdout)


def clean(answer: str) -> str:
    text = answer.replace("\r\n", "\n")
    start = text.find("---\n")
    if start < 0:
        raise ValueError("answer has no front-matter")
    text = re.sub(r"\n```\s*$", "\n", text[start:].rstrip()) + "\n"
    meta, _ = split_front_matter(text)
    if meta.get("status") != "draft":
        raise ValueError("front-matter missing or status is not draft")
    return text


def write(guide: Guide, article: str) -> Path:
    target = GUIDES_DIR / guide.slug / "index.md"
    if target.exists() and split_front_matter(target.read_text(encoding="utf-8"))[0].get("status") == "approved":
        target = target.with_name("index.next.md")
    target.write_text(article, encoding="utf-8", newline="\n")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slugs", nargs="*")
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--jobs", type=int, default=3)
    args = parser.parse_args()
    unknown = [slug for slug in args.slugs if slug not in BY_SLUG]
    if unknown:
        parser.error(f"unknown slug(s): {', '.join(unknown)}")
    chosen = [BY_SLUG[slug] for slug in args.slugs] or [g for g in GUIDES if manifest(g.slug)]
    failed = 0
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_agy, guide, args.model): guide for guide in chosen}
        for future in cf.as_completed(futures):
            guide = futures[future]
            try:
                print(f"ok   {guide.slug} -> {write(guide, future.result()).relative_to(ROOT)}", flush=True)
            except Exception as error:  # report and keep going; one bad answer must not stop the batch
                failed += 1
                print(f"FAIL {guide.slug}: {error}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
