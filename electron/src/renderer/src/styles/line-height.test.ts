import { expect, it } from 'vitest';

/**
 * Vietnamese stacks diacritics above and below the letter (Ổ, Ặ, ợ). Truncated or clipped text
 * with a line height under about 1.3 cuts those marks off, and wrapped text under 1.35 lets the
 * marks of one line touch the next (DESIGN.md, Typography).
 */
const tsx = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const css = import.meta.glob(['../**/*.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

it('never pairs truncated or clamped text with a tight line height', () => {
  expect(Object.keys(tsx).length).toBeGreaterThan(100);
  const hits: string[] = [];
  for (const [file, source] of Object.entries(tsx)) {
    for (const match of source.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      const classes = match[1];
      if (
        /\b(truncate|line-clamp-\d)\b/.test(classes) &&
        /\bleading-(none|tight|snug|3)\b/.test(classes)
      )
        hits.push(`${file.replace('../', '')}: ${classes.slice(0, 80)}`);
    }
  }
  expect(hits).toEqual([]);
});

it('keeps text line heights at 1.15 or more in stylesheets', () => {
  // Single-glyph boxes (prices, icon buttons, initials) may sit at 1: they never wrap or carry
  // diacritics.
  const allowed = /price|icon|initial|avatar|kbd|badge-dot/;
  const hits: string[] = [];
  for (const [file, source] of Object.entries(css)) {
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const value = /line-height:\s*([\d.]+)\s*;/.exec(match[2]);
      if (!value || Number(value[1]) >= 1.15 || Number(value[1]) > 4) continue;
      const selector = match[1].trim();
      if (allowed.test(selector) || /height:\s*\d+px/.test(match[2])) continue;
      hits.push(`${file.replace('../', '')}: ${selector} ${value[1]}`);
    }
  }
  expect(hits).toEqual([]);
});
