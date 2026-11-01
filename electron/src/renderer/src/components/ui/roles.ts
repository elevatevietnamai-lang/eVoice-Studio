/**
 * Component roles: what each UI primitive is for, which tokens it takes, and which motion it gets.
 * Agents read this (and the table in DESIGN.md section 4) before building or restyling a screen.
 * `roles.test.ts` fails when a file in this folder has no entry, so a new primitive must be declared.
 *
 * Motion vocabulary (durations come from DESIGN.md: fast 160 ms, base 240 ms, slow 480 ms):
 * - `none`: no animation beyond the colour transition every control gets from globals.css.
 * - `feedback`: a state change (hover, press, checked) shown with a 160 ms colour or opacity change.
 * - `enter-exit`: appears and disappears with an opacity fade, plus a small drift for floating layers.
 * - `loop`: continuous activity indicator; the only allowed loops, and always reducible.
 * - `morph`: the icon changes shape when state changes (MorphIcon).
 * - `reveal`: content slides open by height or opacity.
 */
export type ComponentRole =
  | 'action'
  | 'input'
  | 'selection'
  | 'navigation'
  | 'overlay'
  | 'feedback'
  | 'status'
  | 'container'
  | 'structure'
  | 'hint'
  | 'icon';

export type MotionKind = 'none' | 'feedback' | 'enter-exit' | 'loop' | 'morph' | 'reveal';

export interface ComponentSpec {
  role: ComponentRole;
  /** One line: when to reach for it. */
  use: string;
  /** Semantic tokens it reads. Never raw palette colours. */
  tokens: string[];
  /** Typography class from the semantic scale. */
  type: 'text-ui' | 'text-label' | 'text-caption' | 'text-editor' | 'inherit';
  motion: MotionKind;
  /** Motion detail an agent can copy. */
  motionNote: string;
  /** Never do this with it. */
  avoid?: string;
}

const press = 'Colour and opacity change over 160 ms; no scale or bounce.';

export const componentRoles: Record<string, ComponentSpec> = {
  alert: {
    role: 'status',
    use: 'Inline message that stays on the page: error, warning, info, success.',
    tokens: ['--destructive', '--warning', '--info', '--success', '--card'],
    type: 'text-ui',
    motion: 'none',
    motionNote: 'Static. Wrap in FadeIn when it appears after a user action.',
    avoid: 'Do not use for transient confirmations; use Toaster.',
  },
  badge: {
    role: 'status',
    use: 'Short label or count next to a name (state, tier, language).',
    tokens: ['--secondary', '--secondary-foreground', '--primary', '--destructive'],
    type: 'text-caption',
    motion: 'none',
    motionNote: 'Static.',
    avoid: 'Do not make it clickable; use Button or Toggle.',
  },
  button: {
    role: 'action',
    use: 'Any action. One primary per view; secondary, outline or ghost for the rest.',
    tokens: ['--primary', '--primary-foreground', '--secondary', '--accent', '--destructive', '--ring'],
    type: 'text-ui',
    motion: 'feedback',
    motionNote: press,
    avoid: 'No gradients, glow or inset highlights. Do not animate icon swaps unless the icon changes state.',
  },
  card: {
    role: 'container',
    use: 'Group of related content on the surface ladder.',
    tokens: ['--card', '--card-foreground', '--border', '--card-radius'],
    type: 'inherit',
    motion: 'enter-exit',
    motionNote: 'Optional FadeIn (8 px drift, 240 ms) on first mount; Stagger (40 ms) for grids.',
    avoid: 'No shadows; depth comes from the border and surface step.',
  },
  collapsible: {
    role: 'structure',
    use: 'Disclosure that hides secondary content.',
    tokens: ['--border', '--muted-foreground'],
    type: 'text-ui',
    motion: 'reveal',
    motionNote: 'Panel height and opacity animate over 240 ms (Base UI start and end styles).',
  },
  dialog: {
    role: 'overlay',
    use: 'Modal task or confirmation that blocks the page.',
    tokens: ['--popover', '--popover-foreground', '--border', '--ring'],
    type: 'text-ui',
    motion: 'enter-exit',
    motionNote: 'Backdrop and panel fade over 160 ms; the panel also scales from 95%. Closes the same way.',
    avoid: 'Do not stack dialogs; no blur on the backdrop.',
  },
  input: {
    role: 'input',
    use: 'Single-line text, number, search or password entry.',
    tokens: ['--input', '--background', '--foreground', '--placeholder', '--ring', '--destructive'],
    type: 'text-ui',
    motion: 'feedback',
    motionNote: 'Border and ring colour over 160 ms on focus.',
    avoid: 'Do not use a placeholder as the only label.',
  },
  kbd: {
    role: 'hint',
    use: 'Keyboard shortcut hint.',
    tokens: ['--muted', '--muted-foreground', '--border'],
    type: 'text-caption',
    motion: 'none',
    motionNote: 'Static.',
  },
  label: {
    role: 'structure',
    use: 'Visible name for a form control; always bound with htmlFor or wrapping.',
    tokens: ['--foreground'],
    type: 'text-label',
    motion: 'none',
    motionNote: 'Static.',
  },
  'morph-icon': {
    role: 'icon',
    use: 'Icon that changes shape with state (play to pause, menu to close, sun to moon).',
    tokens: ['currentColor'],
    type: 'inherit',
    motion: 'morph',
    motionNote: 'Spring "snappy", reducedMotion "user", stroke 1.75.',
    avoid: 'Do not use for icons that never change; use lucide-react.',
  },
  progress: {
    role: 'feedback',
    use: 'Determinate progress of a known task (download, render, install).',
    tokens: ['--primary', '--secondary', '--muted-foreground'],
    type: 'text-caption',
    motion: 'feedback',
    motionNote: 'Indicator width eases over 240 ms.',
    avoid: 'Use Spinner when the duration is unknown.',
  },
  'scroll-area': {
    role: 'structure',
    use: 'Scrollable region with a themed scrollbar.',
    tokens: ['--border', '--muted-foreground'],
    type: 'inherit',
    motion: 'feedback',
    motionNote: 'Focus ring only; the scrollbar thumb changes colour over 160 ms.',
  },
  select: {
    role: 'selection',
    use: 'Pick one option from a list of five or more; use ToggleGroup for fewer.',
    tokens: ['--input', '--popover', '--popover-foreground', '--accent', '--ring'],
    type: 'text-ui',
    motion: 'enter-exit',
    motionNote: 'List fades in over 160 ms, slides in from its anchor and scales from 95%; items change colour over 160 ms.',
  },
  separator: {
    role: 'structure',
    use: 'Hairline between groups.',
    tokens: ['--border'],
    type: 'inherit',
    motion: 'none',
    motionNote: 'Static.',
  },
  skeleton: {
    role: 'feedback',
    use: 'Placeholder shape while content loads.',
    tokens: ['--muted'],
    type: 'inherit',
    motion: 'loop',
    motionNote: 'Tailwind animate-pulse; stops under reduced motion.',
    avoid: 'Do not use for tasks longer than a few seconds; show Progress.',
  },
  slider: {
    role: 'input',
    use: 'Pick a value in a range (speed, volume, strength).',
    tokens: ['--primary', '--secondary', '--ring'],
    type: 'text-label',
    motion: 'feedback',
    motionNote: 'Thumb ring on focus over 160 ms; the value follows the pointer.',
  },
  sonner: {
    role: 'feedback',
    use: 'Transient toast confirming an action or reporting a background result.',
    tokens: ['--popover', '--popover-foreground', '--border', '--destructive', '--success'],
    type: 'text-ui',
    motion: 'enter-exit',
    motionNote: 'Library default slide and fade; auto-dismiss.',
    avoid: 'Never the only place an error is shown.',
  },
  spinner: {
    role: 'feedback',
    use: 'Activity of unknown duration inside a button or small region.',
    tokens: ['currentColor'],
    type: 'inherit',
    motion: 'loop',
    motionNote: 'Continuous rotation; must stop under reduced motion.',
  },
  switch: {
    role: 'selection',
    use: 'Setting that applies immediately (on or off).',
    tokens: ['--primary', '--input', '--ring'],
    type: 'text-ui',
    motion: 'feedback',
    motionNote: 'Thumb translates and track colour changes with the default 160 ms transition.',
    avoid: 'Do not use when a Save step is needed; use a checkbox.',
  },
  tabs: {
    role: 'navigation',
    use: 'Switch between peer views inside one page.',
    tokens: ['--muted', '--foreground', '--muted-foreground', '--ring'],
    type: 'text-ui',
    motion: 'feedback',
    motionNote: 'Active indicator and text colour change over 160 ms; panel content swaps with no slide.',
  },
  textarea: {
    role: 'input',
    use: 'Multi-line text entry (scripts, prompts, lyrics).',
    tokens: ['--input', '--background', '--foreground', '--placeholder', '--ring'],
    type: 'text-editor',
    motion: 'feedback',
    motionNote: 'Border and ring colour over 160 ms on focus.',
  },
  'toggle-group': {
    role: 'selection',
    use: 'Choose one or several from a short set (two to four) shown side by side.',
    tokens: ['--secondary', '--accent', '--border', '--ring'],
    type: 'text-label',
    motion: 'feedback',
    motionNote: press,
  },
  toggle: {
    role: 'selection',
    use: 'Single pressed or unpressed button (bold, mute, favourite).',
    tokens: ['--accent', '--accent-foreground', '--ring'],
    type: 'text-label',
    motion: 'feedback',
    motionNote: press + ' Pair with MorphIcon when the icon changes with the state.',
  },
  tooltip: {
    role: 'hint',
    use: 'Name or explain an icon-only control; never essential information.',
    tokens: ['--popover', '--popover-foreground', '--border'],
    type: 'text-caption',
    motion: 'enter-exit',
    motionNote: 'Fades in, slides a few px from its anchor and scales from 95%.',
    avoid: 'Do not put interactive content inside.',
  },
};

/** Motion kit outside `components/ui`, listed here so one file names every animated building block. */
export const motionKit = {
  MotionProvider:
    'Wrap the app once; reducedMotion "user" turns every motion component off for people who ask.',
  FadeIn:
    'Fade plus 8 px drift on mount. For a page section, a card or a result appearing after a user action.',
  Stagger:
    'Container that reveals StaggerItem children 40 ms apart. For grids and lists of at most about 12 items.',
  StaggerItem: 'Child of Stagger.',
  RouteFade:
    'App shell wraps the routed page: opacity-only fade over 160 ms, keyed on the top-level route segment.',
  MorphIcon: 'See morph-icon above.',
} as const;
