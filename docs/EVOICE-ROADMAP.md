# eVoice Studio roadmap

**Last updated:** 2026-11-08 · **Owner:** Elevate Labs

eVoice Studio is Elevate Labs' build of VoiceStudio: the same local-first engines and pipelines, with the Elevate
brand, a redesigned interface and its own distribution at `labs.elevatemarketing.vn/evoice-studio`. The upstream
plan for engines, performance and quality stays in [ROADMAP.md](ROADMAP.md); this file tracks only what is
specific to eVoice.

**Legend:** ✅ done · 🟡 in progress · ⏳ not started · ⏸ deferred · 🔒 needs an owner decision

## 1. Interface redesign (branch `ui-redesign`)

| Item | Status | Notes |
|---|---|---|
| Elevate tokens: monochrome palette, radius scale 8 / 12 / 20, concentric nested corners | ✅ | `DESIGN.md` sections 2 and 4, guard tests in `lib/themes/` |
| Icon rail, panel column, group menus in the panel column | ✅ | `components/app-shell/` |
| Interaction states by function: shadcn focus ring, flat selection, hover only on controls | ✅ | |
| Motion: route settle, menu cascade, details expand, Motion (motion.dev) kit | ✅ | `components/motion` |
| MorphIcon on every two-state icon | ✅ | `morphicons`, guarded in `no-decorative-effects.test.ts` |
| Select, menu and segmented controls on the shared grammar | ✅ | `menu-popup.ts`, `segmented.ts` |
| Display hierarchy, motion tokens, layers, breakpoints documented | ✅ | `DESIGN.md` sections 3, 4, 6, 8 |
| Move the remaining `text-lg` titles onto the hierarchy | ⏳ | Clone, Dub, Tools, Transcriptions |
| Visual review of Setup, Music Studio and the mobile apps | ⏳ | `DESIGN.md` Known Gaps |
| Merge `ui-redesign` into the eVoice `main` | 🔒 | After the owner's UI check on the installer |

## 2. Distribution

| Item | Status | Notes |
|---|---|---|
| Windows x64 installer built locally | ✅ | `bun run dist`; `ELECTRON_MIRROR` works around GitHub outages |
| Landing page, Vietnamese and English, device-language detection | ✅ | Artifact draft; to be hosted on the Labs domain |
| Host the installer and its SHA-256 at `labs.elevatemarketing.vn/evoice-studio/download/` | ⏳ | The landing page already links there |
| Publish the eVoice source repository (AGPL-3.0 source offer for every binary) | 🔒 | `elevatevietnamai-lang/eVoice-Studio` |
| Code-sign the Windows installer (removes the SmartScreen warning) | 🔒 | Needs a certificate |
| Stop eVoice builds offering upstream VoiceStudio updates | ✅ | `config/app.json` `applicationUpdates: false`: no update check, no release list, no update notice; Settings → Updates says checks are off |
| In-app update notices from eVoice's own release feed | ⏸ | Deferred by the owner (2026-11-13) until eVoice has its own release process. Then: publish eVoice releases with `latest.yml`, point `electron/src/main/updater.ts` at them, set `applicationUpdates` back to `true` |
| macOS (arm64) and Linux (AppImage, deb) installers | ⏳ | Same build scripts; needs a Mac signer and a Linux test pass |

## 3. Product

| Item | Status | Notes |
|---|---|---|
| Animated word-level captions on burned subtitles (ffmpeg + ASS) | 🟡 | Branch `feat/caption-fx-audiogram` |
| Audiogram video for audiobooks and podcasts | 🔒 | Waiting on the chosen visual format |
| Programmatic video templates (Remotion, Motion Canvas, Revideo) | ⏳ | Not adopted: licence and local-first conflicts; revisit only for a confirmed template need |
| Paid tier: VoiceStudio Pro page (Settings → Support, `/pro`) | ⏸ | Kept as is by the owner (2026-11-13). It is the upstream author's paid plan, sold at `voicestudio.sh/pro`; in eVoice builds it cannot be activated and gates no feature. Decide later: hide it, or replace it with an eVoice plan |
| Vietnamese copy review across the app | ⏳ | Locale `vi` written by translation; needs a native pass |

## How to update this file

Change a row's status in the same commit as the work, keep notes to one line, and move finished upstream
work to [ROADMAP.md](ROADMAP.md) instead of duplicating it here.
