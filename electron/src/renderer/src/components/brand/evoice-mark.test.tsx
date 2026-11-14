import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import logo from '../../../../../../docs/logo.svg?raw';
import { BARS, COLORS, EVoiceMark, SPARK } from './evoice-mark';

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

it('paints the brand gradient and orange star, with one gradient id per instance', () => {
  const { container } = render(
    <>
      <EVoiceMark size={64} />
      <EVoiceMark size={64} />
    </>,
  );
  const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);
  expect(new Set(ids).size).toBe(2);
  const [bars, spark] = container.querySelectorAll('svg')[0].querySelectorAll('path');
  expect(bars.getAttribute('fill')).toBe(`url(#${ids[0]})`);
  expect(spark.getAttribute('fill')).toBe(COLORS.spark);
  const stops = [...container.querySelectorAll('svg')[0].querySelectorAll('stop')];
  expect(stops.map((stop) => stop.getAttribute('stop-color'))).toEqual([COLORS.top, COLORS.bottom]);
});

it('follows the theme in mono tone', () => {
  const { container } = render(<EVoiceMark size={64} tone="mono" />);
  expect(container.querySelector('linearGradient')).toBeNull();
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
