import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(path: string, encoding: 'utf8'): string;
        readdirSync(path: string, options: { recursive: true }): string[];
      };
    };
  }
).process.getBuiltinModule('node:fs');

const root = 'src/renderer/src';
const sources = fs
  .readdirSync(root, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.') && !file.startsWith('components/ui/'))
  .map((file) => ({ file, text: fs.readFileSync(`${root}/${file}`, 'utf8') }));

/**
 * A disclosure sits in a panel beside fields, so its frame takes the control radius (8 px). The
 * frame comes from `<Collapsible framed>`; call sites that drew their own picked 12 px.
 */
it('frames disclosures with the shared frame, never the card radius', () => {
  const offenders = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/<Collapsible\b(?![A-Z])[^>]*>/g)]
      .filter(([tag]) => tag.includes('rounded-(--card-radius)'))
      .map(() => file),
  );
  expect(offenders).toEqual([]);
});

/** A disclosure that a switch turns on opens through `<Reveal>` (DESIGN.md, motion by function). */
it('reveals a conditionally shown disclosure instead of popping it in', () => {
  const offenders = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/&&\s*\(\s*<Collapsible\b(?![A-Z])/g)]
      .filter((match) => !/<Reveal>\s*\{[^{}]*$/.test(text.slice(Math.max(0, match.index - 200), match.index)))
      .map(() => file),
  );
  expect(offenders).toEqual([]);
});
