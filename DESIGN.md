---
version: alpha
name: eVoice Studio
description: |
  eVoice Studio is a local-first desktop app for voice cloning, voice design, video dubbing,
  dictation and music, used by creators and small studios who work for hours in one window.
  The interface follows the Elevate brand: monochrome, dark first, flat surfaces, quiet motion.
  Three things must always hold: text and controls are graphite on off-white or white on near-black;
  the only saturated colours are functional status colours; nothing glows, blurs or glosses.
source:
  kind: codebase
  files:
    - electron/src/renderer/src/styles/t3-theme.css
    - electron/src/renderer/src/styles/globals.css
    - electron/src/renderer/src/components/ui/
    - electron/src/renderer/src/components/motion/index.tsx
    - electron/src/renderer/src/components/ui/morph-icon.tsx
    - electron/src/renderer/src/lib/themes/
  brand: eVoice-brand/brand-guideline.md (Elevate brand kit, snapshot)
  extractedAt: 2026-10-31
  tokensMeasured: false   # read from source and the generated mobile tokens, not from a running page
colors:
  # Elevate core palette (t3-theme.css --brand-*). Components use the semantic roles below.
  black: "#030305"
  graphite: "#15191b"
  white: "#f6f6f6"
  off-white: "#f8f8f6"
  silver: "#a1a3a6"
  steel: "#575b5f"
  light:
    bg: "#f8f8f6"
    surface: "#ffffff"          # card, popover
    surface-2: "#f0f0ee"        # secondary, muted, sidebar
    surface-3: "#ebebe8"        # accent (hover, selected)
    ink: "#15191b"
    muted: "#575b5f"
    primary: "#15191b"
    primary-ink: "#f6f6f6"
    border: "rgb(21 25 27 / 12%)"
    border-strong: "rgb(21 25 27 / 20%)"   # inputs
    focus: "#15191b"
  dark:
    bg: "#030305"
    surface: "#0d0e10"
    surface-2: "#15171a"
    surface-3: "#191b1f"
    ink: "#f6f6f6"
    muted: "#a1a3a6"
    primary: "#f6f6f6"
    primary-ink: "#15191b"
    border: "rgb(246 246 246 / 12%)"
    border-strong: "rgb(246 246 246 / 20%)"
    focus: "#f6f6f6"
  functional:               # deliberate exception to monochrome, see section 2
    error: { light: "#c10007", dark: "#ff6467" }
    warning: { light: "#bb4d00", dark: "#ffb900" }
    update-dark: "#51a2ff"
typography:
  ui: "Inter Variable"
  display: "Space Grotesk Variable"
  subsets: [latin, latin-ext, vietnamese]
  fallback: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  steps:
    ui: { size: "0.875rem", lineHeight: "1.25rem" }
    label: { size: "0.8125rem", lineHeight: "1.25rem" }
    caption: { size: "0.75rem", lineHeight: "1rem" }
    editor: { size: "1rem", lineHeight: "1.75rem" }
  heading: { family: display, appliesTo: "h1, h2, h3, .font-heading" }
rounded:
  control: "8px"            # --control-radius, buttons, inputs
  card: "16px"              # --card-radius
  base: "8px"               # --radius; sm 4px, md 6px, lg 8px, xl 11.2px, 2xl 14.4px
spacing:
  workspace-gap: "1rem"
  workspace-inset: "1.5rem"
  titlebar-height: "52px"
  footer-height: "40px"
shadows: "shadow-xs on the primary button only; no other drop shadows"
gradients: none
elevationStrategy: flat
components:
  button-xs: { height: "24px", icon: "14px" }
  button-sm: { height: "28px", icon: "14px" }
  button-default: { height: "32px", icon: "16px", radius: "{rounded.control}", background: "{colors.light.primary}", textColor: "{colors.light.primary-ink}" }
  button-lg: { height: "36px", icon: "16px" }
  input: { height: "32px", border: "{colors.light.border-strong}", radius: "6px" }
  card: { radius: "{rounded.card}", surface: "{colors.light.surface}" }
states:
  hover-primary: { background: "primary at 90%" }
  focus-visible: { ring: "--ring (graphite light, off-white dark) at 50% alpha" }
contrast:                   # WCAG 2.x, computed with the design-md contrast script
  light:
    ink-on-bg: 16.64
    ink-on-surface: 17.70
    muted-on-bg: 6.44
    muted-on-surface: 6.85
    muted-on-surface-2: 6.00
    primary-ink-on-primary: 16.37
    error-on-bg: 6.04
    warning-on-bg: 4.73
  dark:
    ink-on-bg: 19.07
    ink-on-surface: 17.87
    muted-on-bg: 8.15
    muted-on-surface: 7.64
    muted-on-surface-2: 7.10
    primary-ink-on-primary: 16.37
    ink-on-surface-3: 15.96
    error-on-bg: 7.13
    warning-on-bg: 11.96
    update-on-bg: 7.81
  failures: []
  guard: "electron/src/renderer/src/lib/themes/brand-contrast.test.ts fails below 4.5:1 for text roles and 3:1 for focus"
motion:
  fast: "160 ms"
  base: "240 ms"
  slow: "480 ms"
  easing: "cubic-bezier(0.22, 1, 0.36, 1)"
  css: "--default-transition-duration 160 ms and --default-transition-timing-function set in globals.css @theme"
  js: "components/motion: MotionProvider (reducedMotion=user), FadeIn (8 px drift), Stagger (40 ms)"
  icons: "components/ui/morph-icon.tsx, spring snappy, reducedMotion user, stroke 1.75"
  reducedMotion: "globals.css cuts CSS animation and transition to 0.01 ms; MotionConfig reducedMotion=user covers motion; MorphIcon reducedMotion=user"
themes:
  default: "Elevate (this file)"
  selectable: [studio, signal, canopy, current, hearth, orchid, heritage]
  note: "Studio Classic ('studio') is the previous zinc and blue default. Named palettes override the default through html[data-theme-id]."
coverage:
  applied: [tokens, fonts, ui-components, motion-provider, morph-icons-in-4-controls, brand-mark, home-layout]
  notApplied: [setup-and-music-layouts, voice-dub-design-layouts]
---

# Design System: eVoice Studio

## 1. Visual Theme & Atmosphere

Dark Editorial Minimalism with restrained accents, taken from the Elevate brand and adapted to a dense tool. Dark is the primary expression, light is the content-first one. The app should feel precise and calm, not like a neon AI product.

Key characteristics:
- Monochrome UI: ink on bg, one neutral ladder of three surfaces (`surface`, `surface-2`, `surface-3`).
- Primary action is graphite (light) or off-white (dark), never a hue.
- Flat: surfaces separate by background step and a 12% border, not by shadow or blur.
- Headings in Space Grotesk, everything else in Inter.
- Motion is short (160 to 480 ms) and always reducible.
- Status is the only place colour appears (section 2).

## 2. Color Palette & Roles

| Role | Light | Dark | Use |
|---|---|---|---|
| bg | `#f8f8f6` | `#030305` | App canvas |
| surface | `#ffffff` | `#0d0e10` | Cards, popovers, dialogs |
| surface-2 | `#f0f0ee` | `#15171a` | Secondary, muted fills, sidebar |
| surface-3 | `#ebebe8` | `#191b1f` | Hover and selected rows |
| ink | `#15191b` | `#f6f6f6` | Body text, icons |
| muted | `#575b5f` | `#a1a3a6` | Secondary text, placeholders |
| primary / primary-ink | `#15191b` / `#f6f6f6` | `#f6f6f6` / `#15191b` | Main button, selected controls |
| border | 12% graphite | 12% white | Hairlines |
| border-strong | 20% graphite | 20% white | Input outlines |
| focus | `#15191b` | `#f6f6f6` | Focus ring base (50% alpha) |

Rules:
- Components use semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`), never `--brand-*` and never hex.
- **Functional colours are an intentional exception.** Error, warning, success, info and the dark-mode update colour keep a hue (`#c10007`/`#ff6467`, `#bb4d00`/`#ffb900`) because a tool needs status readable at a glance. Always pair them with text or an icon, never colour alone. The Elevate rule "success is monochrome" is not adopted.
- Brand `text-muted` values `#717478` (dark) and `#8b8e91` (light) are not used: they fall under 4.5:1.
- `silver` on off-white fails (2.4:1); do not put `--brand-silver` on a light surface.
- Contrast is in the front matter and guarded by `brand-contrast.test.ts`.

## 3. Typography Rules

- UI: Inter Variable. Headings (`h1` to `h3`, `.font-heading`): Space Grotesk Variable. Both come from `@fontsource-variable` with `latin`, `latin-ext` and `vietnamese` subsets, self-hosted, so the app works offline.
- Sizes come from theme tokens: `text-ui` 14/20, `text-label` 13/20, `text-caption` 12/16, `text-editor` 16/28.
- Do not set Space Grotesk on controls or body text. Do not add a third family; mono is only for code and logs.
- Vietnamese stacks diacritics: keep line height at or above the token values and avoid all-caps for long labels.
- CJK and other scripts fall back to the system stack.

## 4. Component Stylings

- **Button** (`components/ui/button.tsx`): heights 24 (xs), 28 (sm), 32 (default), 36 (lg); icon buttons are square at the same sizes. Radius 8 px. Primary is flat (no inset highlight), `shadow-xs`, hover at 90%. Variants: default, outline, secondary, ghost, destructive, link. Icons 14 px (xs, sm) or 16 px.
- **Input, Select, Textarea**: 32 px high, 6 px radius, `border-input`, fill at 20% of the input token; focus shows the ring at 50% alpha.
- **Card**: 16 px radius (`--card-radius`), `ring-1`, no shadow.
- **Dialog, popover, select menu**: `surface-glass` utility. In the default theme blur is 0 and opacity 100%, so they are solid; named palettes keep the frosted look.
- **Tabs, Toggle, Switch, Slider, Progress**: filled with `primary`; never a hue.
- **Icons**: `lucide-react` for static icons (stroke 1.75). Use `MorphIcon` (`components/ui/morph-icon.tsx`) only where an icon changes state: theme toggle, sidebar toggle, play and pause. Pass Lucide icon data from `lucide`, not a component.
- **Toasts**: `sonner`, status colours follow section 2.
- Hover, active and disabled states are inherited from the component files; document a new one here when you add it.

## 5. Layout Principles

- Desktop app window with a 52 px draggable title bar and a 40 px footer. Workspace gap 1 rem, inset 1.5 rem.
- Dense by design: the Elevate web button height of 48 px does not apply; controls stay at 24 to 36 px.
- Left sidebar plus one workspace pane; panes use `workspace-titlebar` for the header.
- Page layouts were not redesigned in this pass (section 10).

## 6. Depth & Elevation

Flat. Depth comes from the surface ladder (bg, surface, surface-2, surface-3) and hairline borders. No drop shadows except `shadow-xs` on the primary button. No gradients, glow or glassmorphism in the default theme.

## 7. Do's and Don'ts

**Do**
- Use semantic tokens in every component (`grep -rn "#[0-9a-f]\{6\}" components/ui` should stay empty).
- Pair every status colour with text or an icon.
- Keep primary actions graphite or off-white.
- Use 160 ms for hover and focus, 240 ms for panels, 480 ms only for large reveals.
- Wrap new motion in `MotionProvider` descendants or use CSS transitions, so reduced motion applies.
- Add a unit test when adding a themed colour role; contrast must reach 4.5:1 for text.
- Keep Studio Classic and the other palettes selectable.

**Don't**
- No gradients, glows, coloured shadows or frosted surfaces in the default theme.
- No hue for the primary button, selection, focus ring or progress fill.
- No `--brand-*` variables or hex values inside components.
- No third font family; no Space Grotesk on body text.
- No loops, bounces, parallax or autoplaying animation.
- Do not use `MorphIcon` for icons that never change.
- Do not use `--brand-silver` text on light backgrounds.

## 8. Responsive Behavior

Desktop first: the window has a minimum size set by Electron and the sidebar collapses to compact mode (`useWorkspaceSidebarState`). No custom breakpoints are defined in `globals.css`; Tailwind defaults apply. Minimum touch target is not specified for the desktop UI. Widths to check by eye: 1024, 1280, 1440, and the compact sidebar.

## 9. Agent Prompt Guide

**Quick reference**
- Canvas `#f8f8f6` / `#030305`, ink `#15191b` / `#f6f6f6`, muted `#575b5f` / `#a1a3a6`.
- Radius: control 8 px, card 16 px.
- Heights: 24, 28, 32, 36 px.
- Motion: 160 / 240 / 480 ms, `cubic-bezier(0.22, 1, 0.36, 1)`.
- Headings Space Grotesk, UI Inter.

**When adding or changing UI**
1. Use components from `components/ui`; add variants there, not inline classes.
2. Take colours from semantic tokens. For a new role, add it to `t3-theme.css` and `lib/themes`, then run `bun scripts/export-mobile-tokens.ts` (the mobile apps share the tokens).
3. Run `bun run typecheck`, `bun run lint`, `cd electron && bun x vitest run src/renderer/src/lib/themes src/renderer/src/components`.
4. Check light and dark, the compact sidebar, and `prefers-reduced-motion`.
5. Update this file in the same change.

**Sample prompt**: "Add a settings row with a switch and a help tooltip. Use `components/ui`, semantic tokens only, 32 px controls, no new colours, and follow DESIGN.md."

## 10. Known Gaps

- `tokensMeasured` is false: values are read from source and the generated tokens, not from a running page. Compare computed styles in the browser pane against `t3-theme.css` once the backend is up.
- Success and info foreground colours come from Tailwind palette names (`emerald`, `blue`) and are not in the theme role list; their contrast was not computed.
- In dark mode `--update-foreground` is blue (`#51a2ff`) while light mode uses graphite; the update banner is therefore the one non-functional hue left. Decide whether to make it monochrome.
- Home is flat and monochrome (a test blocks hue classes). Setup, Music Studio and the Voice, Dub and Design screens keep their earlier layouts and were not checked visually in this pass.
- Page layouts, Setup, Dub, Voice and Music Studio screens keep their previous structure.
- No breakpoints or touch-target sizes are documented; they were not measured.
- Mobile apps receive the new default through generated tokens but their screens were not reviewed.
- `electron/src/shared/` legacy components may still carry older colours and were not checked.
- Brand guideline (`eVoice-brand/brand-guideline.md`) says buttons are 48 px and cards use a lighter hover lift; the desktop app intentionally uses its denser sizes.
