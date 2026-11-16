#!/usr/bin/env python3
"""Attach a locally built Windows installer's update feed to its GitHub release.

The in-app updater reads `electron-<stable|beta>-win32-x64.yml` from the
release, then downloads the installer it names, using the `.blockmap` for
differential downloads. A release that carries only the `.exe` cannot update
anyone. This script checks the three files `bun run dist` left in
`electron/release/` belong together and match the tag, then uploads them with
`gh release upload` to the repository in config/app.json `updateRepository`.

    python scripts/publish_windows_update_assets.py --tag v0.5.7-beta.4
    python scripts/publish_windows_update_assets.py --tag v0.5.7-beta.4 --dry-run
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAG = re.compile(r"^v(\d+\.\d+\.\d+(?:-beta\.\d+)?)$")


class FeedError(RuntimeError):
    """The local build cannot serve an in-app update for this tag."""


def channel_for(version: str, arch: str = "x64") -> str:
    kind = "beta" if re.fullmatch(r"\d+\.\d+\.\d+-beta\.\d+", version) else "stable"
    return f"electron-{kind}-win32-{arch}"


def _field(manifest: str, pattern: str, label: str) -> str:
    match = re.search(pattern, manifest, re.MULTILINE)
    if not match:
        raise FeedError(f"update manifest is missing {label}")
    return match.group(1).strip().strip("'\"")


def update_assets(release_dir: Path, tag: str, arch: str = "x64") -> list[Path]:
    """The manifest, installer and blockmap for ``tag``, verified against each other."""
    match = TAG.match(tag)
    if not match:
        raise FeedError(f"{tag} is not a vX.Y.Z or vX.Y.Z-beta.N release tag")
    version = match.group(1)
    manifest_path = release_dir / f"{channel_for(version, arch)}.yml"
    if not manifest_path.is_file():
        found = sorted(p.name for p in release_dir.glob("electron-*-win32-*.yml"))
        raise FeedError(
            f"{manifest_path.name} not found in {release_dir} (found: {found or 'none'}). "
            "Rebuild with `bun run dist` at this version."
        )
    manifest = manifest_path.read_text(encoding="utf-8")
    declared = _field(manifest, r"^version:\s*(.+)$", "version")
    if declared != version:
        raise FeedError(f"{manifest_path.name} is for {declared}, not {version}")
    installer = release_dir / _field(manifest, r"^path:\s*(.+)$", "path")
    if not installer.is_file():
        raise FeedError(f"installer {installer.name} named by {manifest_path.name} is missing")
    digest = hashlib.sha512()
    with installer.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    if base64.b64encode(digest.digest()).decode() != _field(
        manifest, r"^sha512:\s*(.+)$", "sha512"
    ):
        raise FeedError(f"{installer.name} does not match the sha512 in {manifest_path.name}")
    blockmap = installer.with_name(installer.name + ".blockmap")
    if not blockmap.is_file():
        raise FeedError(f"{blockmap.name} is missing (differential updates need it)")
    return [installer, blockmap, manifest_path]


def update_repository() -> str:
    config = json.loads((ROOT / "config" / "app.json").read_text(encoding="utf-8"))
    return config["updateRepository"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tag", required=True)
    parser.add_argument("--release-dir", type=Path, default=ROOT / "electron" / "release")
    parser.add_argument("--arch", default="x64", choices=("x64", "arm64"))
    parser.add_argument("--repo", default=None, help="owner/name (default: config/app.json)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        assets = update_assets(args.release_dir, args.tag, args.arch)
    except FeedError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    repo = args.repo or update_repository()
    command = ["gh", "release", "upload", args.tag, *map(str, assets), "--repo", repo, "--clobber"]
    print("Update feed verified:", ", ".join(path.name for path in assets))
    if args.dry_run:
        print("Would run:", " ".join(command))
        return 0
    subprocess.run(command, check=True)
    names = json.loads(
        subprocess.run(
            ["gh", "release", "view", args.tag, "--repo", repo, "--json", "assets"],
            check=True, capture_output=True, text=True,
        ).stdout
    )["assets"]
    missing = {path.name for path in assets} - {asset["name"] for asset in names}
    if missing:
        print(f"error: release {args.tag} still lacks {sorted(missing)}", file=sys.stderr)
        return 1
    print(f"{args.tag}: in-app updates can now offer this build")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
