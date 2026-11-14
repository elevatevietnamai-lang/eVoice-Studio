import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import logo from '../../../../../../docs/logo.svg?raw';
import { BARS, COLORS, EVoiceMark, SPARK, TILE } from './evoice-mark';

afterEach(cleanup);

it('is decorative by default and named when given a label', () => {
  const { container, rerender } = render(<EVoiceMark />);
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  rerender(<EVoiceMark label="eVoice Studio" />);
  expect(screen.getByRole('img', { name: 'eVoice Studio' })).toBeTruthy();
});

it('drops the cut-out star at 20 px and below unless asked for the full cut', () => {
  const { container, rerender } = render(<EVoiceMark size={20} />);
  const svg = () => container.querySelector('svg')!;
  expect(svg().dataset.mark).toBe('small');
  expect(svg().querySelector('path')?.getAttribute('d')).toBe(BARS.small);
  rerender(<EVoiceMark size={24} />);
  expect(svg().dataset.mark).toBe('full');
  expect(svg().querySelector('path')?.getAttribute('d')).toBe(BARS.full);
  rerender(<EVoiceMark size={16} cut="full" />);
  expect(svg().dataset.mark).toBe('full');
});

it('paints a white mark, on the near-black tile only in the light theme by default', () => {
  const { container } = render(<EVoiceMark size={64} />);
  const svg = container.querySelector('svg')!;
  expect(svg.dataset.tile).toBe('auto');
  expect(container.querySelector('linearGradient')).toBeNull();
  for (const path of svg.querySelectorAll('path')) {
    expect(path.getAttribute('fill')).toBe(COLORS.mark);
  }
  const tiled = svg.querySelector('[data-part="tiled"]')!;
  const bare = svg.querySelector('[data-part="bare"]')!;
  expect(tiled.querySelector('rect')?.getAttribute('fill')).toBe(COLORS.tile);
  // The dark theme hides the tile; the light theme hides the bare mark.
  expect(tiled.getAttribute('class')).toContain('dark:hidden');
  expect(bare.getAttribute('class')).toContain('hidden');
  expect(bare.getAttribute('class')).toContain('dark:inline');
});

it('keeps the tile in both themes when asked, and drops it on request', () => {
  const { container, rerender } = render(<EVoiceMark size={64} tile="always" />);
  const svg = () => container.querySelector('svg')!;
  expect(svg().querySelector('[data-part="bare"]')).toBeNull();
  expect(svg().querySelector('[data-part="tiled"]')?.getAttribute('class') ?? '').not.toContain('hidden');
  rerender(<EVoiceMark size={64} tile="none" />);
  expect(svg().querySelector('rect')).toBeNull();
  expect(svg().querySelector('[data-part="bare"]')?.getAttribute('class') ?? '').not.toContain('hidden');
});

it('fills a small tile like docs/logo-small.svg so the mark is not lost at 32 px and below', () => {
  const { container, rerender } = render(<EVoiceMark size={24} tile="always" />);
  const inner = () => container.querySelector('[data-part="tiled"] > g')!.getAttribute('transform');
  expect(inner()).toContain(`scale(${TILE.small.scale})`);
  rerender(<EVoiceMark size={56} tile="always" />);
  expect(inner()).toContain(`scale(${TILE.full.scale})`);
});

it('follows the theme in mono tone, without a tile', () => {
  const { container } = render(<EVoiceMark size={64} tone="mono" />);
  expect(container.querySelector('rect')).toBeNull();
  for (const path of container.querySelectorAll('path')) {
    expect(path.getAttribute('fill')).toBe('currentColor');
  }
});

it('matches the canonical docs/logo.svg geometry', () => {
  // docs/logo.svg holds the same paths placed on a 64-unit tile; compare the shape, not the scale.
  const commands = (d: string) => d.replace(/[^A-Za-z]/g, '');
  const paths = [...logo.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
  expect(paths.map(commands)).toEqual([commands(BARS.full), commands(SPARK)]);
});
