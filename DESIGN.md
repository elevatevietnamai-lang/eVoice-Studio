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
  applied: [tokens, fonts, ui-components, component-roles, workspace-menu, header, window-controls, scrollbars, motion-provider, morph-icons-in-4-controls, brand-mark, home-layout]
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
- Never fade `text-muted-foreground` with an opacity suffix (`/55`): it falls below 4.5:1. Muted is the lowest text level; hover and selected text step up to `text-foreground`. `no-faded-muted-text.test.ts` enforces this.
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
- **Glass mode** (Settings → Appearance) applies to named palettes only: every `[data-glass='true']` rule also requires `[data-theme-id]`, which the default Studio theme never sets. The switch is disabled with a hint while Studio is active. `globals.test.ts` enforces this.
- **Selected rows** use a flat surface (`--sidebar-row-selected` in sidebars, `bg-accent` elsewhere). No 2 px accent bar, inset highlight or glow.
- **Call sites never re-style primitives** with gradients, white highlight edges, primary glows, hover shadows, hover blur or hover scale. Card-like containers use the Card grammar: `rounded-(--card-radius)`, `border-border`, `bg-card`, no shadow. `no-decorative-effects.test.ts` enforces this.
- **Tabs, Toggle, Switch, Slider, Progress**: filled with `primary`; never a hue.
- **Icons**: `lucide-react` for static icons (stroke 1.75). Use `MorphIcon` (`components/ui/morph-icon.tsx`) only where an icon changes state: theme toggle, sidebar toggle, play and pause. Pass Lucide icon data from `lucide`, not a component.
- **Toasts**: `sonner`, status colours follow section 2.
- **Workspace menu** (`components/app-shell/workspace-menu.tsx`): flat rows, 32 px high. Rest uses `--sidebar-muted-foreground`, hover `--sidebar-row-hover`, current page `--sidebar-row-selected` with `--sidebar-foreground`. Icons are single-colour and static; no per-item hues, glow, blur or hover animation. Groups: Voice, Stories, Dubbing, More (transcribe, calls, tools, integrations), then Projects. Group open and close takes 240 ms; the compact rail opens each group as a menu on click (hover only shows the name). A test (`nav-style.test.ts`) blocks gradients, blur and hue classes in the menu, sidebar, header and status bar.
- **Rail** (compact sidebar): the logo (30 px) at the top opens the full menu. Group icons show their name in a tooltip on hover and open a menu on click; its items show icon, name and description, and choosing one goes to the page with its control panel open. The panel toggle sits at the bottom of the rail (and of the full menu's footer) on every platform; panes and page headers carry no collapse button of their own. Every navigation reopens the panel.
- **Window buttons** (Windows and Linux, `window-controls.tsx`): minimize, maximize or restore, and close are React buttons (46 by 40 px) mounted at the app root, so setup and the backend gate have them too. Hover uses `bg-accent`; close turns `--destructive`. They call `bridge.window`. The cost of drawing them: Windows 11's Snap Layouts flyout (on the native maximize button) is gone; edge dragging and Win+arrow snapping still work.
- **Search field** (`command-search.tsx`): wide panes centre a 26 rem field under the header; narrow ones show a 32 px icon button. It opens the command palette, which drops from the top (`top-16`) with a search row, grouped options, a visible selected row (`--sidebar-row-selected`) and key hints.
- **Scrollbars**: every scroll container gets a 12 px bar with a 6 px rounded thumb, no arrow buttons, thumb at 50% foreground (3:1 at rest), 68% on hover, 85% while dragging.
- **Popovers, selects, tooltips, account menu**: fade and scale from 97% over 200 ms in (`--ease-standard`) and 150 ms out, using Base UI `data-starting-style` and `data-ending-style` transitions; they can be interrupted mid-way.
- **Header**: title on the left; the command-palette button and account corner on the right. No promotional buttons (Get Pro and the GitHub star badge were removed; the Pro page stays under Settings).
- Hover, active and disabled states are inherited from the component files; document a new one here when you add it.
- **Interaction state rules** (tested for all 8 palettes in `brand-contrast.test.ts`): a hovered sidebar row differs from the sidebar by at least 1.15:1 and a selected row by 1.25:1; a hovered toolbar control by 1.15:1; the muted label stays at 4.5:1 on both; input and select borders (`--input`) reach 3:1 on the canvas (WCAG 1.4.11). Hover on ghost, outline and toggle controls uses `bg-accent`, never `bg-muted` or a fractional alpha of it. Input fills use `--control-fill`, not `--input`.

### Component roles

Source of truth: `components/ui/roles.ts` (`roles.test.ts` fails when a primitive has no entry or is missing from this table). Read the role before choosing a component; motion kinds are defined at the top of that file.

| Component | Role | Use | Tokens | Type | Motion |
|---|---|---|---|---|---|
| `alert` | status | Inline message that stays on the page: error, warning, info, success. | `--destructive` `--warning` `--info` `--success` `--card` | `text-ui` | none: Static. Wrap in FadeIn when it appears after a user action. Avoid: Do not use for transient confirmations; use Toaster. |
| `badge` | status | Short label or count next to a name (state, tier, language). | `--secondary` `--secondary-foreground` `--primary` `--destructive` | `text-caption` | none: Static. Avoid: Do not make it clickable; use Button or Toggle. |
| `button` | action | Any action. One primary per view; secondary, outline or ghost for the rest. | `--primary` `--primary-foreground` `--secondary` `--accent` `--destructive` `--ring` | `text-ui` | feedback: Colour and opacity change over 160 ms; no scale or bounce. Avoid: No gradients, glow or inset highlights. Do not animate icon swaps unless the icon changes state. |
| `card` | container | Group of related content on the surface ladder. | `--card` `--card-foreground` `--border` `--card-radius` | `inherit` | enter-exit: Optional FadeIn (8 px drift, 240 ms) on first mount; Stagger (40 ms) for grids. Avoid: No shadows; depth comes from the border and surface step. |
| `collapsible` | structure | Disclosure that hides secondary content. | `--border` `--muted-foreground` | `text-ui` | reveal: Panel height and opacity animate over 240 ms (Base UI start and end styles). |
| `dialog` | overlay | Modal task or confirmation that blocks the page. | `--popover` `--popover-foreground` `--border` `--ring` | `text-ui` | enter-exit: Backdrop and panel fade over 200 ms; the panel also scales from 95%. Closes the same way. Avoid: Do not stack dialogs; no blur on the backdrop. |
| `input` | input | Single-line text, number, search or password entry. | `--input` `--background` `--foreground` `--placeholder` `--ring` `--destructive` | `text-ui` | feedback: Border and ring colour over 160 ms on focus. Avoid: Do not use a placeholder as the only label. |
| `kbd` | hint | Keyboard shortcut hint. | `--muted` `--muted-foreground` `--border` | `text-caption` | none: Static. |
| `label` | structure | Visible name for a form control; always bound with htmlFor or wrapping. | `--foreground` | `text-label` | none: Static. |
| `morph-icon` | icon | Icon that changes shape with state (play to pause, menu to close, sun to moon). | `currentColor` | `inherit` | morph: Spring "snappy", reducedMotion "user", stroke 1.75. Avoid: Do not use for icons that never change; use lucide-react. |
| `progress` | feedback | Determinate progress of a known task (download, render, install). | `--primary` `--secondary` `--muted-foreground` | `text-caption` | feedback: Indicator width eases over 240 ms. Avoid: Use Spinner when the duration is unknown. |
| `scroll-area` | structure | Scrollable region with a themed scrollbar. | `--border` `--muted-foreground` | `inherit` | feedback: Focus ring only; the scrollbar thumb changes colour over 160 ms. |
| `select` | selection | Pick one option from a list of five or more; use ToggleGroup for fewer. | `--input` `--popover` `--popover-foreground` `--accent` `--ring` | `text-ui` | enter-exit: List fades in and scales from 97% over 200 ms (Base UI start and end styles); items change colour over 160 ms. |
| `separator` | structure | Hairline between groups. | `--border` | `inherit` | none: Static. |
| `skeleton` | feedback | Placeholder shape while content loads. | `--muted` | `inherit` | loop: Tailwind animate-pulse; stops under reduced motion. Avoid: Do not use for tasks longer than a few seconds; show Progress. |
| `slider` | input | Pick a value in a range (speed, volume, strength). | `--primary` `--secondary` `--ring` | `text-label` | feedback: Thumb ring on focus over 160 ms; the value follows the pointer. |
| `sonner` | feedback | Transient toast confirming an action or reporting a background result. | `--popover` `--popover-foreground` `--border` `--destructive` `--success` | `text-ui` | enter-exit: Library default slide and fade; auto-dismiss. Avoid: Never the only place an error is shown. |
| `spinner` | feedback | Activity of unknown duration inside a button or small region. | `currentColor` | `inherit` | loop: Continuous rotation; must stop under reduced motion. |
| `switch` | selection | Setting that applies immediately (on or off). | `--primary` `--input` `--ring` | `text-ui` | feedback: Thumb translates and track colour changes with the default 160 ms transition. Avoid: Do not use when a Save step is needed; use a checkbox. |
| `tabs` | navigation | Switch between peer views inside one page. | `--muted` `--foreground` `--muted-foreground` `--ring` | `text-ui` | feedback: Active indicator and text colour change over 160 ms; panel content swaps with no slide. |
| `textarea` | input | Multi-line text entry (scripts, prompts, lyrics). | `--input` `--background` `--foreground` `--placeholder` `--ring` | `text-editor` | feedback: Border and ring colour over 160 ms on focus. |
| `toggle-group` | selection | Choose one or several from a short set (two to four) shown side by side. | `--secondary` `--accent` `--border` `--ring` | `text-label` | feedback: Colour and opacity change over 160 ms; no scale or bounce. |
| `toggle` | selection | Single pressed or unpressed button (bold, mute, favourite). | `--accent` `--accent-foreground` `--ring` | `text-label` | feedback: Colour and opacity change over 160 ms; no scale or bounce. Pair with MorphIcon when the icon changes with the state. |
| `tooltip` | hint | Name or explain an icon-only control; never essential information. | `--popover` `--popover-foreground` `--border` | `text-caption` | enter-exit: Fades in and scales from 97% over 200 ms (Base UI start and end styles). Avoid: Do not put interactive content inside. |

Motion kit (`components/motion`, `components/ui/morph-icon.tsx`):

- `MotionProvider`: Wrap the app once; reducedMotion "user" turns every motion component off for people who ask.
- `FadeIn`: Fade plus 8 px drift on mount. For a page section, a card or a result appearing after a user action.
- `Stagger`: Container that reveals StaggerItem children 40 ms apart. For grids and lists of at most about 12 items.
- `StaggerItem`: Child of Stagger.
- `RouteFade`: App shell wraps the routed page: opacity-only fade over 240 ms, keyed on the top-level route segment.
- `MorphIcon`: See morph-icon above.

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
- Use 160 ms for hover and focus, 200 ms for overlays, 240 ms for panels (the control panel's width animates on fold, never while dragged), 480 ms only for large reveals.
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
- Radius: control 8 px, card 16 px. App code uses only these two: `rounded-lg` (or smaller) for controls, rows, icon tiles and blocks nested inside a card, and `rounded-(--card-radius)` for cards, panels, banners and chat bubbles. `rounded-xl`, `rounded-2xl` and `rounded-3xl` stay inside `components/ui` only; `no-decorative-effects.test.ts` enforces this.
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
- Error, warning and update colours are tested at 4.5:1 on canvas and surface for every palette (`brand-contrast.test.ts`). Success and info come from Tailwind steps (emerald-700 and blue-600 on light, 500 on dark, computed by hand, not in the token file) and have no automated test.
- In dark mode `--update-foreground` is blue (`#51a2ff`) while light mode uses graphite; the update banner is therefore the one non-functional hue left. Decide whether to make it monochrome.
- Home is flat and monochrome (a test blocks hue classes). Setup, Music Studio and the Voice, Dub and Design screens keep their earlier layouts and were not checked visually in this pass.
- Page layouts, Setup, Dub, Voice and Music Studio screens keep their previous structure.
- No breakpoints or touch-target sizes are documented; they were not measured.
- Mobile apps receive the new default through generated tokens but their screens were not reviewed.
- `electron/src/shared/` legacy components may still carry older colours and were not checked.
- Brand guideline (`eVoice-brand/brand-guideline.md`) says buttons are 48 px and cards use a lighter hover lift; the desktop app intentionally uses its denser sizes.
