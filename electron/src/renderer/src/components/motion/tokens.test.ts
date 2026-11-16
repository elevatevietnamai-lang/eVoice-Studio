import { expect, it } from 'vitest';
import { ROUTE_FADE_SECONDS, menuSurfaceMotion, motionTokens } from './index';

// vitest stubs `.css` imports, so read the stylesheet through Node. cwd is `electron/`.
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

const sources = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function cssVar(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  expect(match, name).not.toBeNull();
  return match![1]!.trim();
}

const ms = (seconds: number) => `${Math.round(seconds * 1000)}ms`;
const bezier = (curve: readonly number[]) => `cubic-bezier(${curve.join(', ')})`;

it('keeps the CSS motion tokens equal to their motion/react twins', () => {
  expect(cssVar('--motion-fast')).toBe(ms(motionTokens.fast));
  expect(cssVar('--motion-base')).toBe(ms(motionTokens.base));
  expect(cssVar('--motion-slow')).toBe(ms(motionTokens.slow));
  expect(cssVar('--motion-hover')).toBe(ms(motionTokens.hover));
  expect(cssVar('--motion-panel')).toBe(ms(motionTokens.panel));
  expect(cssVar('--ease-standard')).toBe(bezier(motionTokens.ease));
  expect(cssVar('--ease-settle')).toBe(bezier(motionTokens.settle));
});

it('gives every transition utility the shared hover timing', () => {
  expect(cssVar('--default-transition-duration')).toBe('var(--motion-hover)');
  expect(cssVar('--default-transition-timing-function')).toBe('var(--ease-settle)');
});

it('settles the panel column and the page content together on a switch', () => {
  expect(ROUTE_FADE_SECONDS).toBe(motionTokens.panel);
  expect(css).toMatch(
    /\.secondary-sidebar \{\s*animation: route-settle var\(--motion-panel\) var\(--ease-settle\) both;/,
  );
});

it('opens the rail group menu as a wipe, and as a short fade under reduced motion', () => {
  const full = menuSurfaceMotion(false);
  expect(full.initial).toHaveProperty('clipPath');
  expect(full.animate.transition.duration).toBe(motionTokens.reveal);
  expect(full.exit.transition.duration).toBe(motionTokens.exit);
  const reduced = menuSurfaceMotion(true);
  expect(reduced.initial).not.toHaveProperty('clipPath');
  expect(reduced.animate.transition.duration).toBe(motionTokens.fast);
});

/**
 * Hovers felt abrupt because each control picked its own 150 or 160 ms on the quint curve. Colour
 * and opacity feedback now takes the default (`--motion-hover`, `--ease-settle`); a bare
 * `duration-150` / `duration-160` brings the one-off timing back. Enter and exit styles of popups
 * (`data-ending-style:duration-150`, `motion-reduce:duration-150`) are not hovers and stay.
 */
it('leaves hover timing to the shared token instead of one-off durations', () => {
  const offenders = Object.entries(sources).flatMap(([file, source]) =>
    [...source.matchAll(/(?<![\w:-])duration-1[56]0\b/g)].map(() => file),
  );
  expect(offenders).toEqual([]);
});
