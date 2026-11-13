# VoiceStudio brand

The app ships as **eVoice Studio**. Its mark is four rounded voice bars in an
orange-to-pink gradient, with a four-point star cut between the second and third
bar and a smaller orange star above the last one. The bars identify audio; the
stars identify creation. The product voice is clear, calm, and direct.

## Assets

| Surface | Source |
|---|---|
| Primary vector icon (dark tile) | `docs/logo.svg` |
| Small cut for 32 px and below | `docs/logo-small.svg` |
| README mark | `docs/logo.png` and `docs/logo-256.png` |
| Browser icon | `electron/public/favicon.svg` (a copy of `docs/logo-small.svg`), plus `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png` and `site.webmanifest` |
| In-app mark (Electron) | `EVoiceMark` in `electron/src/renderer/src/components/brand/evoice-mark.tsx` (brand colours, or `tone="mono"` for `currentColor`) |
| In-app mark (shared legacy chrome) | `electron/src/shared/components/brand/VoiceStudioMark.jsx` (one colour) |
| Desktop/platform icons | `electron/build/icons/` |
| iOS App Store icon | `mobile/ios/VoiceStudio/AppIcon.svg` → `Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png` |
| Integration directory tile | `electron/src/shared/assets/integrations/voicestudio.svg` |
| Sidebar/launchpad artwork | `electron/public/signal-field.webp` |

Regenerate every desktop icon from the canonical vectors after changing the
mark:

```sh
uv run scripts/render_brand_icons.py
```

It renders `docs/logo.svg` to the README PNGs, `icon.png` and the larger ICO
frames under `electron/build/icons/`, and `docs/logo-small.svg` to `32x32.png`,
the tray icons and the ICO frames of 32 px and below. The macOS ICNS places the
tile on Apple's 824 px grid inside a 1024 px canvas; it is written with
`iconutil` on macOS and with Pillow elsewhere. Then run the Electron packaging
contract.

`docs/logo.svg` must stay plain: a tile `<rect>`, then exactly two top-level
`<path>` elements (the bars with the star already subtracted, filled with the
`bars` gradient, and the orange star), with no `<mask>`, `<g>` or `transform`.
Android generates its vectors from it with
`mobile/android/scripts/generate_brand_resources.py`, which copies only those
paths (VectorDrawable has no masks) and places the mark 56 dp tall on the 108 dp
adaptive canvas, inside the 66 dp safe circle; the themed icon paints both paths
white. `tests/test_voicestudio_branding.py` checks these rules.

Do not redraw the mark per screen. Use `EVoiceMark` (or `VoiceStudioMark` in
shared code) in React and the canonical SVGs elsewhere, so the silhouette stays
recognizable at 16–512 px. At 20 px and below `EVoiceMark` drops the cut-out
star, which would otherwise blur into a few pixels.

## Palette

| Role | Color |
|---|---|
| Bars, top | `#F8981D` |
| Bars, bottom | `#FF32A3` |
| Star | `#F88537` |
| Tile and text on light | `#030305` |
| Text on dark | `#F6F6F6` |

The mark may render in one color inside app chrome. Keep the bars and both
stars together; do not put text inside the icon or add another enclosing ring.

## Name and copy

- Product name: **VoiceStudio**—one word, capital V and S.
- Voice: concise, professional, warm, and direct.
- Promise: local-first creation without a subscription or usage meter.
- Avoid absolute privacy claims: network-backed engines, downloads, analytics,
  and cloud integrations are explicit opt-ins, not nonexistent.
- Attribute the bundled default model as **k2-fsa/OmniVoice** where model lineage
  matters. OmniVoice is an upstream model/runtime name, not the product name.

## Compatibility names

The rebrand must not break existing installations. Keep these identifiers until
a separately tested migration exists:

- `omnivoice` Python imports and package name
- `omnivoice-studio` binary/package, Docker Hub path, and legacy GHCR alias
- `OMNIVOICE_*` environment variables and `X-OmniVoice-*` API headers
- existing OmniVoice data/cache directories and uninstall aliases
- upstream repositories, model IDs, classes, and engine IDs

Visible copy can explain those compatibility names, but must not silently rename
them on disk or over the wire.

Electron uses the shared multi-resolution ICO for Windows window/taskbar and tray
icons, the shared PNG for Linux and macOS runtime icons, and the ICNS for the macOS
bundle. The tray icon restores the window; closing the app retains its existing
quit behavior. Installed executable icons are applied when building the installer.
