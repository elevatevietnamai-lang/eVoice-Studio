"""A hand-published Windows release must carry its in-app update feed.

v0.5.7-beta.3 shipped only the installer: the build had stamped its manifest
`electron-stable-win32-x64.yml` although the version was a beta, and the
manifest and blockmap were never uploaded, so no install could update from it.
"""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "publish_windows_update_assets", ROOT / "scripts" / "publish_windows_update_assets.py"
)
pub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pub)


def _build(tmp_path: Path, version: str, channel: str, *, payload=b"installer bytes",
           declared=None, blockmap=True) -> Path:
    exe = tmp_path / f"eVoice-Studio-Electron-{version}-win-x64.exe"
    exe.write_bytes(payload)
    if blockmap:
        exe.with_name(exe.name + ".blockmap").write_bytes(b"map")
    sha = base64.b64encode(hashlib.sha512(payload).digest()).decode()
    (tmp_path / f"{channel}.yml").write_text(
        f"version: {declared or version}\nfiles:\n  - url: {exe.name}\n    sha512: {sha}\n"
        f"    size: {len(payload)}\npath: {exe.name}\nsha512: {sha}\n",
        encoding="utf-8",
    )
    return exe


def test_beta_tag_uploads_installer_blockmap_and_beta_manifest(tmp_path):
    exe = _build(tmp_path, "0.5.7-beta.4", "electron-beta-win32-x64")
    assets = pub.update_assets(tmp_path, "v0.5.7-beta.4")
    assert [p.name for p in assets] == [
        exe.name, exe.name + ".blockmap", "electron-beta-win32-x64.yml",
    ]


def test_stable_tag_uses_the_stable_manifest(tmp_path):
    _build(tmp_path, "0.5.8", "electron-stable-win32-x64")
    assert pub.update_assets(tmp_path, "v0.5.8")[-1].name == "electron-stable-win32-x64.yml"


def test_beta_build_stamped_stable_is_refused(tmp_path):
    """The v0.5.7-beta.3 failure: a beta whose manifest Beta never reads."""
    _build(tmp_path, "0.5.7-beta.3", "electron-stable-win32-x64")
    with pytest.raises(pub.FeedError, match="electron-beta-win32-x64.yml not found"):
        pub.update_assets(tmp_path, "v0.5.7-beta.3")


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"declared": "0.5.7-beta.3"}, "is for 0.5.7-beta.3"),
        ({"blockmap": False}, "blockmap is missing"),
    ],
)
def test_mismatched_or_incomplete_builds_are_refused(tmp_path, kwargs, message):
    _build(tmp_path, "0.5.7-beta.4", "electron-beta-win32-x64", **kwargs)
    with pytest.raises(pub.FeedError, match=message):
        pub.update_assets(tmp_path, "v0.5.7-beta.4")


def test_installer_changed_after_the_manifest_is_refused(tmp_path):
    exe = _build(tmp_path, "0.5.7-beta.4", "electron-beta-win32-x64")
    exe.write_bytes(b"rebuilt installer")
    with pytest.raises(pub.FeedError, match="does not match the sha512"):
        pub.update_assets(tmp_path, "v0.5.7-beta.4")


def test_non_release_tags_are_refused(tmp_path):
    with pytest.raises(pub.FeedError, match="not a vX.Y.Z"):
        pub.update_assets(tmp_path, "v0.5.7-rc.1")


def test_uploads_go_to_the_configured_update_repository():
    config = json.loads((ROOT / "config" / "app.json").read_text(encoding="utf-8"))
    assert config["applicationUpdates"] is True
    assert pub.update_repository() == config["updateRepository"] != "debpalash/VoiceStudio"
