import { expect, it } from 'vitest';

// vitest stubs `.css` imports (`css: false`), so read the file through Node directly.
const nodeProcess = (globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string } };
}).process;
const css = nodeProcess.getBuiltinModule('node:fs').readFileSync('src/renderer/src/styles/globals.css', 'utf8');

/** Tailwind v4 preflight leaves buttons on the arrow cursor, so the base layer must restore the hand. */
it('shows a pointer on clickable controls and not-allowed on disabled ones', () => {
  const start = css.indexOf('cursor: pointer;');
  expect(start).toBeGreaterThan(0);
  const rule = css.slice(css.lastIndexOf(':is(', start), start);
  for (const selector of ['button', "[role='tab']", "[role='switch']", "[role='option']", 'summary']) {
    expect(rule, selector).toContain(selector);
  }
  expect(css).toContain('cursor: not-allowed;');
});

it('themes every scrollbar with a slim thumb, no arrow buttons and a stronger hover', () => {
  expect(css).toContain('*::-webkit-scrollbar-thumb');
  expect(css).toMatch(/\*::-webkit-scrollbar-button\s*\{\s*display: none;/);
  expect(css).toContain('--scrollbar-thumb-hover');
  expect(css).not.toMatch(/scrollbar-color:/);
});

/** The default Studio theme is flat (DESIGN.md): glass effects may only reach the named palettes. */
it('keeps glass effects off the default theme', () => {
  const selectors = css.match(/html[^{,]*\[data-glass='true'\][^{,]*/g) ?? [];
  expect(selectors.length).toBeGreaterThan(5);
  for (const selector of selectors) expect(selector, selector).toContain('[data-theme-id]');
});
