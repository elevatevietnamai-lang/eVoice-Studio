import { expect, it } from 'vitest';

const rendererSources = import.meta.glob('../../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

/** Opening tag from `start`, skipping `>` inside `{…}` expressions such as arrow functions. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

/**
 * Clickable text controls (filter chips, example chips, insert-token chips, toggles) keep the
 * 8 px control corner of the main Button (DESIGN.md). Only square icon controls (a `size-N`
 * box or a `size="icon…"` Button) may be circles; a pill reads as a different kind of control.
 */
it('gives clickable text controls the button corner, never a pill', () => {
  const offenders: string[] = [];
  for (const [path, source] of Object.entries(rendererSources)) {
    if (path.endsWith('.test.tsx')) continue;
    for (const match of source.matchAll(/<(?:button|Button|Toggle|ToggleGroupItem|a|Link)\b/g)) {
      const tag = openingTag(source, match.index);
      if (!/\brounded-full\b/.test(tag)) continue;
      if (/\bsize-\d|\bsize=(?:"|\{[^}]*')icon/.test(tag)) continue;
      offenders.push(`${path}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  expect(offenders).toEqual([]);
});
