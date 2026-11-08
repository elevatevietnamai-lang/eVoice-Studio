import { describe, expect, it } from 'vitest';

/**
 * DESIGN.md: flat surfaces, the Elevate radius scale (control, card, surface), no gradients, glow, highlight edges or
 * scale on hover. The primitives
 * (Button, Card) follow it; this stops call sites from layering the old effects back on top.
 */
const sources = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RULES: [name: string, pattern: RegExp][] = [
  ['gradient', /\b(?:bg-gradient-to-|bg-linear-to-|bg-radial)/],
  ['white highlight edge', /shadow-\[[^\]]*rgb\(255_255_255/],
  ['primary glow', /shadow-\[[^\]]*\d+px[^\]]*var\(--primary\)/],
  ['drop shadow on hover', /hover:shadow-\[/],
  ['scale on hover', /(?:hover|group-hover)[^\s'"]*:scale-/],
  ['blur on hover', /hover:backdrop-blur/],
  ['highlight edge', /shadow-\[inset_0_1px_0/],
  // Controls use rounded-lg and smaller, cards and menus rounded-(--card-radius); the 20 px surface
  // radius belongs to the Dialog primitive and the browser dialog stylesheet.
  ['off-scale radius', /(?<![\w-])rounded-(?:xl|2xl|3xl\b|\(--surface-radius\))/],
  // Menus sit on the card radius (Elevate --radius-md, 12 px), not the control radius.
  ['menu off the card radius', /Menu\.Popup[^>]*\brounded-(?:sm|md|lg)\b/],
];

// A dark scrim keeps the white caption readable over a user's photo.
const ALLOWED = ['components/profile-avatar.tsx:gradient'];

describe('no decorative effects outside the design system', () => {
  it('scans the renderer sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });
  it.each(RULES)('no %s at call sites', (name, pattern) => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      if (file.includes('/components/ui/')) continue;
      if (ALLOWED.some((entry) => entry === `${file.replace('../../', '')}:${name}`)) continue;
      source.split(/\r?\n/).forEach((line, index) => {
        if (pattern.test(line)) hits.push(`${file}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

/**
 * Rules for every renderer source, primitives included (DESIGN.md): the primitives used to be
 * exempt, which is how a 6 px corner and a tinted pressed state survived in them.
 */
const EVERYWHERE: [name: string, pattern: RegExp][] = [
  // Elevate radius scale: 4 (rounded-sm), 8 (rounded-lg), 12 (card), 20 (surface), pills.
  ['6 px corner', /(?<![\w-])rounded-(?:[trblse]{1,2}-)?md\b|rounded-\[min\(/],
  // Selected, pressed and current states are flat: bg-accent, the sidebar row token, or the
  // raised segment of Tabs and ToggleGroup. Never a primary tint, border or ring. (A checked
  // Switch or Checkbox is filled with primary by design and is not a selection state.)
  [
    'primary-tinted state',
    /(?:aria-(?:pressed|selected|current)|data-(?:pressed|selected|active)|data-\[(?:state=on|state=active|selected|active)[^\]]*\])[^\s'"`]*:(?:bg|border|ring|shadow)-primary/,
  ],
  // Native selects ignore the theme's control styles; use the Select primitive.
  ['native select', /<select\b/],
  // Native checkboxes ignore the theme too; use the Checkbox primitive.
  ['native checkbox', /type=["']checkbox["']/],
  // A translucent primary fill or border has no role in the system: selection is bg-accent,
  // callouts use the Card grammar, icons sit on bg-muted (eVoice brand 5). A solid primary
  // control may darken on hover (`hover:bg-primary/90`, DESIGN.md).
  ['primary tint', /(?<!resize:|hover:)(?<![\w/-])(?:bg|border)-primary\/[\d.[]/],
];

/** Data marks keep the primary: the dub timeline's segments and the tier slider's fill. */
const isDataMark = (file: string, line: string) =>
  file.endsWith('dub-timeline.tsx') || /Slider\.Indicator/.test(line);

/**
 * Segmented controls keep one look, so call sites may size or lay them out but never restyle
 * their surface, corners or chosen state (the voice library's tabs once did, and lost the frame).
 */
it('never restyles Tabs or ToggleGroup surfaces at call sites', () => {
  const element =
    /<(TabsList|TabsTrigger|ToggleGroupItem|ToggleGroup)\b[^>]*?className="([^"]*)"/gs;
  const hits: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (file.includes('/components/ui/')) continue;
    for (const match of source.matchAll(element)) {
      if (/\bbg-|\brounded-|data-active:|aria-pressed:|\bshadow/.test(match[2]))
        hits.push(`${file.replace('../../', '')}: ${match[1]}`);
    }
  }
  expect(hits).toEqual([]);
});

describe('design system rules for every source', () => {
  it.each(EVERYWHERE)('no %s', (name, pattern) => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      source.split(/\r?\n/).forEach((line, index) => {
        if (name === 'primary tint' && isDataMark(file, line)) return;
        if (pattern.test(line)) hits.push(`${file.replace('../../', '')}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

/**
 * Interaction states by function (DESIGN.md): every primitive shows keyboard focus the shadcn way
 * (ring-coloured border plus a 3 px ring at 50 %), and every dropdown menu opens with the shared
 * menu surface and motion instead of appearing without a transition.
 */
describe('interaction states and motion follow one grammar', () => {
  it('uses the shadcn focus ring in every primitive', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      if (!file.includes('/components/ui/')) continue;
      if (/focus-visible:ring-(?:1|2|4)\b|focus-visible:ring-ring\/(?!50\b)\d+/.test(source))
        hits.push(file.replace('../../', ''));
    }
    expect(hits).toEqual([]);
  });
  it('opens every dropdown menu with the shared menu motion', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/<Menu\.Popup\b[^>]*>/gs)) {
        if (!match[0].includes('menuPopupClass')) hits.push(file.replace('../../', ''));
      }
    }
    expect(hits).toEqual([]);
  });
});
