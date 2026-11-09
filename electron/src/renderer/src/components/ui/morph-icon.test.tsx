import { cleanup, render, screen } from '@testing-library/react';
import { Menu, X } from 'lucide';
import { afterEach, expect, it } from 'vitest';
import { MorphIcon } from './morph-icon';

afterEach(cleanup);

it('is decorative unless it has a label', () => {
  const { container, rerender } = render(<MorphIcon icon={Menu} />);
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  rerender(<MorphIcon icon={Menu} label="Open menu" />);
  expect(screen.getByRole('img', { name: 'Open menu' })).toBeTruthy();
});

it('keeps the Lucide stroke width and a stable size class hook', () => {
  const { container } = render(<MorphIcon icon={Menu} className="text-foreground" />);
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('stroke-width')).toBe('1.75');
  expect(svg.getAttribute('class')).toContain('shrink-0');
  expect(svg.getAttribute('class')).toContain('text-foreground');
});

it('accepts a new icon without remounting the svg', () => {
  const { container, rerender } = render(<MorphIcon icon={Menu} />);
  const before = container.querySelector('svg');
  rerender(<MorphIcon icon={X} />);
  expect(container.querySelector('svg')).toBe(before);
});
