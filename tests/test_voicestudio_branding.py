"""VoiceStudio release-brand and source-launch contracts."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from packaging.version import Version

ROOT = Path(__file__).resolve().parents[1]
CURRENT_VERSION = json.loads((ROOT / "package.json").read_text())["version"]


def test_current_version_is_in_lockstep_everywhere() -> None:
    package = json.loads((ROOT / "package.json").read_text())
    assert package["version"] == CURRENT_VERSION

    mirrors = {
        "pyproject.toml": r'(?m)^version = "([^"]+)"',
        "backend/core/version.py": r'(?m)^_FALLBACK_VERSION = "([^"]+)"',
    }
    for path, pattern in mirrors.items():
        match = re.search(pattern, (ROOT / path).read_text())
        assert match and match.group(1) == CURRENT_VERSION, path

    lock_contracts = {"uv.lock": r'name = "omnivoice"\s+version = "([^"]+)"'}
    for path, pattern in lock_contracts.items():
        match = re.search(pattern, (ROOT / path).read_text())
        # uv writes the PEP 440 form of a beta (0.5.9b1 for 0.5.9-beta.1).
        assert match and Version(match.group(1)) == Version(CURRENT_VERSION), path


def test_visible_brand_surfaces_say_voicestudio() -> None:
    visible_files = ("electron/build/Info.plist", "electron/src/renderer/index.html")
    product_name = json.loads((ROOT / "config/app.json").read_text())["productName"]
    assert product_name == "eVoice Studio"
    for path in visible_files:
        text = (ROOT / path).read_text()
        assert "__APP_PRODUCT_NAME__" in text, path
        assert "OmniVoice needs" not in text, path
        assert "OmniVoice may" not in text, path
        assert "OmniVoice Gallery" not in text, path

    readme = (ROOT / "README.md").read_text()
    assert "**VoiceStudio** (default, powered by k2-fsa/OmniVoice)" in readme
    assert "**OmniVoice** (default)" not in readme


# The flattened eVoice mark: four bars with the star knocked out, then the star above.
BARS_START = "M23.744 16.758C23.744 14.821"
MARK_BARS = "M101.5 44C101.5 27.984"
MARK_SPARK = "M273.5 42.5Q282.5 69.5 309.5 78.5"


def _paths(svg: str) -> list[str]:
    return re.findall(r'<path d="([^"]+)"', svg)


def test_brand_mark_is_shared_and_fills_the_icon() -> None:
    mark = (
        ROOT / "electron/src/shared/components/brand/VoiceStudioMark.jsx"
    ).read_text(encoding="utf-8")
    renderer_mark = (
        ROOT / "electron/src/renderer/src/components/brand/evoice-mark.tsx"
    ).read_text(encoding="utf-8")
    header = (ROOT / "electron/src/shared/components/Header.jsx").read_text()
    about = (ROOT / "electron/src/shared/components/settings/AboutTab.jsx").read_text()
    logo = (ROOT / "docs/logo.svg").read_text(encoding="utf-8")
    favicon = (ROOT / "electron/public/favicon.svg").read_text(encoding="utf-8")

    for source in (mark, renderer_mark):
        assert MARK_BARS in source and MARK_SPARK in source
    assert _paths(logo)[0].startswith(BARS_START)
    # The browser icon is the small cut of the app icon: same mark, tighter tile.
    assert favicon == (ROOT / "docs/logo-small.svg").read_text(encoding="utf-8")
    assert 'fill="#030305"' in favicon
    assert "<VoiceStudioMark" in header
    assert "<VoiceStudioMark" in about
    assert 'data-testid="voice-studio-logo"' in header

    # Near-black tile with a white mark: both paths white, no gradient.
    assert '<rect width="64" height="64" rx="14.5" fill="#030305"/>' in logo
    assert re.findall(r'<path d="[^"]+" fill="([^"]+)"', logo) == ["#FFFFFF", "#FFFFFF"]
    assert "<linearGradient" not in logo
    assert 'src="docs/logo.png"' in (ROOT / "README.md").read_text()


@pytest.mark.parametrize("name", ("docs/logo.svg", "docs/logo-small.svg"))
def test_canonical_logo_is_plain_paths_every_pipeline_can_read(name: str) -> None:
    # Android's generator copies only top-level <path>s with their own fill, and
    # VectorDrawable has no masks or inherited transforms: the star cut must be
    # baked into the bars path, not drawn with a mask.
    logo = (ROOT / name).read_text(encoding="utf-8")
    for unsupported in ("<mask", "mask=", "<g", "transform=", "<use", "clip-path"):
        assert unsupported not in logo, unsupported
    paths = _paths(logo)
    assert len(paths) == 2
    assert 'fill="#FFFFFF"' in re.search(r'<path d="[^"]+"[^>]*>', logo).group(0)


# The retired orange-to-pink gradient and orange star; the mark is white everywhere.
RETIRED_BRAND_COLORS = re.compile(r"#?(?:F8981D|FF32A3|F88537)", re.IGNORECASE)
WHITE_MARK_SOURCES = (
    "docs/logo.svg",
    "docs/logo-small.svg",
    "electron/public/favicon.svg",
    "electron/src/shared/assets/integrations/voicestudio.svg",
    "mobile/ios/VoiceStudio/AppIcon.svg",
    "electron/src/renderer/src/components/brand/evoice-mark.tsx",
    "electron/src/shared/components/brand/VoiceStudioMark.jsx",
    "mobile/android/scripts/generate_brand_resources.py",
    "scripts/render_brand_icons.py",
    "scripts/create_google_play_assets.py",
)


@pytest.mark.parametrize("name", WHITE_MARK_SOURCES)
def test_brand_sources_do_not_bring_back_the_gradient(name: str) -> None:
    text = (ROOT / name).read_text(encoding="utf-8")
    assert not RETIRED_BRAND_COLORS.search(text), name
    if name.endswith(".svg"):
        assert "<linearGradient" not in text, name


def test_raster_icons_show_the_bars_and_the_cut_out_star() -> None:
    from PIL import Image

    # Regenerated from docs/logo.svg (and docs/logo-small.svg at 32 px) by scripts/render_brand_icons.py.
    tile = (3, 3, 5)
    for name in (
        "docs/logo.png",
        "docs/logo-256.png",
        "electron/build/icons/icon.png",
        "electron/build/icons/32x32.png",
        "electron/public/icon-192.png",
        "electron/public/icon-512.png",
    ):
        icon = Image.open(ROOT / name).convert("RGB")
        width, height = icon.size
        # On the tall second bar: the white mark, not the tile.
        assert min(icon.getpixel((int(width * 26 / 64), int(height * 20 / 64)))) > 235, name
        # Between the bars and the tile edge: the near-black tile.
        assert max(icon.getpixel((int(width * 8 / 64), int(height * 32 / 64)))) < 24, name
        if width >= 192:
            # Inside the star knocked out of the second bar: the tile shows through.
            pixel = icon.getpixel((int(width * 30 / 64), int(height * 32.24 / 64)))
            assert max(abs(a - b) for a, b in zip(pixel, tile)) < 24, name


@pytest.mark.parametrize(
    "name",
    (
        "electron/public/apple-touch-icon.png",
        "electron/public/maskable-512.png",
        "electron/public/social/voicestudio.jpg",
        "mobile/ios/VoiceStudio/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
        "store/google-play/icon-512.png",
    ),
)
def test_full_bleed_icons_are_a_white_mark_on_the_opaque_tile(name: str) -> None:
    from PIL import Image

    # Rendered from mobile/ios/VoiceStudio/AppIcon.svg (Play: the adaptive icon layout).
    icon = Image.open(ROOT / name)
    assert icon.mode == "RGB", name
    width, height = icon.size
    assert max(icon.getpixel((0, 0))) < 24, name
    # The tall second bar runs through the centre column above the star cut.
    column = [icon.getpixel((x, int(height * 0.4))) for x in range(width)]
    assert any(min(pixel) > 235 for pixel in column), name
    assert not any(pixel[0] - pixel[2] > 60 for pixel in column), name


@pytest.mark.parametrize(
    "name", ("vs_logo", "vs_launcher_foreground", "vs_launcher_monochrome")
)
def test_android_vectors_copy_the_canonical_paths(tmp_path: Path, name: str) -> None:
    import runpy
    import xml.etree.ElementTree as ET

    generator = runpy.run_path(
        str(ROOT / "mobile/android/scripts/generate_brand_resources.py")
    )
    generator["generate"](ROOT, tmp_path)
    android = "{http://schemas.android.com/apk/res/android}"
    vector = ET.parse(tmp_path / f"drawable/{name}.xml").getroot()
    paths = list(vector.iter("path"))
    assert [p.get(android + "pathData") for p in paths] == _paths(
        (ROOT / "docs/logo.svg").read_text(encoding="utf-8")
    )
    bars, spark = paths
    if name == "vs_launcher_monochrome":
        assert (
            bars.get(android + "fillColor")
            == spark.get(android + "fillColor")
            == "#FFFFFFFF"
        )
    else:
        assert bars.find(".//gradient") is None
        assert (
            bars.get(android + "fillColor")
            == spark.get(android + "fillColor")
            == "#FFFFFF"
        )
    if name != "vs_logo":
        # 56 dp mark centred on the 108 dp canvas, inside the 66 dp safe circle.
        group = vector.find("group")
        assert abs(float(group.get(android + "scaleX")) * 37.5 - 56) < 0.01


@pytest.mark.parametrize("event", ("push", "pull_request"))
def test_canonical_logo_changes_run_mobile_builds(event: str) -> None:
    from fnmatch import fnmatchcase

    import yaml

    workflow = yaml.load(
        (ROOT / ".github/workflows/mobile.yml").read_text(encoding="utf-8"),
        Loader=yaml.BaseLoader,
    )
    assert any(
        fnmatchcase("docs/logo.svg", pattern)
        for pattern in workflow["on"][event]["paths"]
    )


def test_python_package_metadata_points_to_voicestudio() -> None:
    pyproject = (ROOT / "pyproject.toml").read_text()
    assert 'Homepage = "https://github.com/debpalash/VoiceStudio"' in pyproject
    assert 'Repository = "https://github.com/debpalash/VoiceStudio"' in pyproject
    assert '"Upstream TTS Model" = "https://github.com/k2-fsa/OmniVoice"' in pyproject


def test_engine_help_names_the_app_not_the_upstream_model() -> None:
    paths = (
        "backend/engines/confucius4/__init__.py",
        "backend/engines/confucius4/bootstrap.py",
        "backend/engines/dots_tts/__init__.py",
        "backend/engines/dots_tts/bootstrap.py",
        "backend/engines/indextts/__init__.py",
        "backend/engines/indextts/bootstrap.py",
        "backend/engines/moss_tts_v15/__init__.py",
        "backend/engines/moss_tts_v15/bootstrap.py",
    )
    stale_help = re.compile(r"(?:restart|reinstall|re-launch|Run) OmniVoice")
    for path in paths:
        text = (ROOT / path).read_text()
        assert not stale_help.search(text), path


def test_compatibility_identifiers_stay_stable() -> None:
    package = json.loads((ROOT / "package.json").read_text())
    assert package["name"] == "omnivoice-studio-monorepo"
    assert 'name = "omnivoice"' in (ROOT / "pyproject.toml").read_text()
    app_config = json.loads((ROOT / "config/app.json").read_text())
    assert app_config["appId"] == "com.voicestudio.desktop"


def test_active_source_launch_is_electron_and_web_ports_clean_quietly() -> None:
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert scripts["dev"] == "bun run --cwd electron dev"
    assert not any("tauri" in name for name in scripts)
    command = scripts["predev:web"]
    assert command.endswith("bun scripts/clear-dev-ports.mjs")
    assert "|| true" not in command


def test_icon_rail_has_no_static_section_captions_and_keeps_air_between_items() -> None:
    rail = (ROOT / "electron/src/shared/components/NavRail.jsx").read_text()
    for stale_caption in ("Start", "Create", "Workflows", "Reference"):
        assert stale_caption not in rail
    assert "pt-[18px]" in rail
    assert "gap-[9px]" in rail


def test_electron_launch_preserves_an_existing_backend():
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    for name in ("predev", "predesktop"):
        assert "clear-dev-ports" not in scripts[name]
        assert "desktop-runtime-preflight" not in scripts[name]
    assert scripts["dev"] == "bun run --cwd electron dev"
    assert scripts["desktop-prod:run"] == "bun run start"
    assert scripts["start"] == "bun run --cwd electron start"
