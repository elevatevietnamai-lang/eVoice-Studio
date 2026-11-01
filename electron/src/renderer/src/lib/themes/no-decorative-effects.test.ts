import { describe, expect, it } from 'vitest';

/**
 * DESIGN.md: flat surfaces, two radii (control and card), no gradients, glow, highlight edges or
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
  // Two radii only: controls (rounded-lg and smaller) and cards (rounded-(--card-radius)).
  ['off-scale radius', /(?<![\w-])rounded-(?:xl|2xl|3xl)\b/],
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
