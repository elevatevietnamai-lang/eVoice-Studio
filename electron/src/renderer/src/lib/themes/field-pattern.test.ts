import { describe, expect, it } from 'vitest';

/**
 * Fields read the same everywhere: a 13 px label 6 px above its control, and the control is the
 * Input or Textarea primitive. Stacked labels once mixed space-y-1/1.5/2 (1 to 16 px apart, the
 * inline label text pulling the gap down to 3 px) and five fields restyled a raw element.
 */
const sources = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx', '!../../components/ui/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RULES: [name: string, pattern: RegExp][] = [
  // A stacked label is `flex flex-col gap-1.5 text-label`; space-y leaves the label inline.
  ['stacked label on space-y', /<label\b[^>]*className="[^"]*\bspace-y-/],
  // A label bound with htmlFor is a block, or a stack's gap does not reach it.
  ['inline htmlFor label', /<label htmlFor=[^>]*className="(?![^"]*\b(?:block|flex|sr-only)\b)[^"]*"/],
  // Raw fields restyled by hand drift from the primitives' fill, radius and focus ring.
  ['hand-styled field', /<(?:input|textarea)\b[^>]*className="[^"]*\bborder-input\b/],
];

describe('field pattern', () => {
  it.each(RULES)('no %s', (_name, pattern) => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      // Multi-line JSX: join each element's attributes onto one line before matching.
      const flat = source.replace(/\r?\n\s*/g, ' ');
      for (const match of flat.matchAll(new RegExp(pattern.source, 'g'))) {
        hits.push(`${file}: ${match[0].slice(0, 90)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
