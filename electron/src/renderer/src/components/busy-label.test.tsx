import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BusyLabel, formatPercent, progressFraction } from './busy-label';

const lang = vi.hoisted(() => ({ value: 'en' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: lang.value } }),
}));
afterEach(() => {
  cleanup();
  lang.value = 'en';
});

it('reads fractions and ratios, and refuses numbers that are not progress', () => {
  expect(progressFraction(0.42)).toBe(0.42);
  expect(progressFraction(3, 4)).toBe(0.75);
  expect(progressFraction(1.7)).toBe(1);
  expect(progressFraction(-0.2)).toBe(0);
  expect(progressFraction(undefined)).toBeNull();
  expect(progressFraction(Number.NaN)).toBeNull();
  expect(progressFraction(2, 0)).toBeNull();
});

it('writes the percent the way the UI language does and never says 100% while running', () => {
  expect(formatPercent(0.42, 'en')).toBe('42%');
  expect(formatPercent(0.42, 'fr').replace(/\s/g, ' ')).toBe('42 %');
  expect(formatPercent(1, 'en')).toBe('99%');
});

it('shows the busy text with the percent, or the busy text alone without a number', () => {
  const { rerender } = render(<BusyLabel label="Generating…" progress={0.3} />);
  expect(screen.getByText('Generating…')).toBeVisible();
  expect(screen.getByText('30%')).toBeVisible();
  rerender(<BusyLabel label="Generating…" progress={null} />);
  expect(screen.queryByText(/%/)).toBeNull();
});
