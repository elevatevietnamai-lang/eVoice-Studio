import { expect, it } from 'vitest';

// vitest stubs `.css` imports (`css: false`), so read the file through Node directly.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
    };
  }
).process;
const css = nodeProcess
  .getBuiltinModule('node:fs')
  .readFileSync('src/renderer/src/styles/globals.css', 'utf8');

/** Tailwind v4 preflight leaves buttons on the arrow cursor, so the base layer must restore the hand. */
it('shows a pointer on clickable controls and not-allowed on disabled ones', () => {
  const start = css.indexOf('cursor: pointer;');
  expect(start).toBeGreaterThan(0);
  const rule = css.slice(css.lastIndexOf(':is(', start), start);
  for (const selector of [
    'button',
    "[role='tab']",
    "[role='switch']",
    "[role='option']",
    'summary',
  ]) {
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

/** DESIGN.md follows the Elevate radius scale: control 8 px, card and menu 12 px, large floating surface 20 px. */
it('pins the Elevate radius scale', () => {
  expect(css).toContain('--control-radius: 0.5rem;');
  expect(css).toContain('--card-radius: 0.75rem;');
  expect(css).toContain('--surface-radius: 1.25rem;');
  const read = (file: string) =>
    nodeProcess.getBuiltinModule('node:fs').readFileSync(`src/renderer/src/${file}`, 'utf8');
  for (const field of ['components/ui/input.tsx', 'components/ui/textarea.tsx']) {
    expect(read(field), field).toContain('rounded-(--control-radius)');
  }
  expect(read('components/ui/dialog.tsx')).toContain('rounded-(--surface-radius)');
  expect(read('components/ui/select.tsx')).toMatch(
    /SelectPrimitive\.Popup[\s\S]*?rounded-\(--card-radius\)/,
  );
});

/**
 * Selected and pressed rows are flat (DESIGN.md): no 2 px accent bar and no primary tint. The
 * library pane kept both in this file after the components dropped them, because no guard read it.
 */
it('keeps selected and pressed states flat, with no accent bars or primary tints', () => {
  expect(css).not.toMatch(/inset\s+-?\d+px\s+0\s+0\s+var\(--primary\)/);
  const rules = [
    ...css.matchAll(/([^{}]*\[(?:aria-pressed|aria-selected|data-selected)[^{}]*)\{([^{}]*)\}/g),
  ];
  expect(rules.length).toBeGreaterThan(0);
  const tinted = rules
    .filter(([, , body]) =>
      /(?:background|border-color|box-shadow)\s*:[^;]*var\(--primary\)/.test(body),
    )
    .map(([, selector]) => selector.trim());
  expect(tinted).toEqual([]);
});

/**
 * Panel sections and cards are not controls, so they get no hover or focus-within feedback: a
 * border that lights up under the pointer promises a click that does nothing (DESIGN.md).
 */
it('gives static panel sections and cards no hover or focus-within effect', () => {
  const rules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(([, selector]) => selector);
  const containerStates = rules.filter((selector) =>
    /:is\([^)]*\b(?:section|form|details)\b[^)]*\):(?:hover|focus-within)/.test(selector),
  );
  expect(containerStates).toEqual([]);
});

/** Fields keep the primitive's own surface and focus state; panes never restyle them from here. */
it('never restyles input, textarea or select surfaces from the shared CSS', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const restyled = rules
    .filter(([, selector]) => /\b(?:input|textarea)\b|\[role='combobox'\]/.test(selector))
    .filter(([, , body]) => /\b(?:background(?:-color)?|border-color|box-shadow)\s*:/.test(body))
    .map(([, selector]) => selector.trim());
  expect(restyled).toEqual([]);
});

/** Expanding cards (<details>) open by height like the Collapsible primitive, never snap. */
it('animates every details element open and closed', () => {
  expect(css).toContain('interpolate-size: allow-keywords;');
  expect(css).toMatch(/details::details-content\s*\{[^}]*transition:[^}]*block-size/);
  expect(css).toMatch(/details\[open\]::details-content\s*\{[^}]*block-size:\s*auto/);
});
