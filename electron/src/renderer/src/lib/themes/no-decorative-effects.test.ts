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
];

describe('design system rules for every source', () => {
  it.each(EVERYWHERE)('no %s', (_name, pattern) => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      source.split(/\r?\n/).forEach((line, index) => {
        if (pattern.test(line)) hits.push(`${file.replace('../../', '')}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
