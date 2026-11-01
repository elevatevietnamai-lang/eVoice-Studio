import { describe, expect, it } from 'vitest';

/**
 * `text-muted-foreground` reaches 4.5:1 in every palette (brand-contrast.test.ts), but an opacity
 * suffix such as `/55` drops it below AA. Lower emphasis must come from the token itself, and hover or
 * selected text steps up to `text-foreground`. Only decorative, aria-hidden drawing surfaces that read
 * `currentColor` may fade it.
 */
const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('muted text keeps its contrast', () => {
  it('scans the renderer sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it('never fades text-muted-foreground with an opacity suffix', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      source.split(/\r?\n/).forEach((line, index) => {
        if (!/text-muted-foreground\/\[?\d/.test(line)) return;
        // The dub timeline's onset canvas draws in currentColor and is aria-hidden.
        const decorativeCanvas =
          file.endsWith('dub-timeline.tsx') && /pointer-events-none absolute inset-0/.test(line);
        if (decorativeCanvas) return;
        hits.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
