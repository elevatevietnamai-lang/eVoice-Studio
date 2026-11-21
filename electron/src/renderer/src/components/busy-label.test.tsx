import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BusyLabel, formatClock, formatPercent, progressFraction, useEta } from './busy-label';

const lang = vi.hoisted(() => ({ value: 'en' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { time?: string }) => (opts?.time ? `${key}:${opts.time}` : key),
    i18n: { language: lang.value },
  }),
}));
afterEach(() => {
  cleanup();
  lang.value = 'en';
  vi.useRealTimers();
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
  expect(screen.getByText('Generating…').parentElement).toHaveTextContent('Generating… 30%');
  rerender(<BusyLabel label="Generating…" progress={null} />);
  expect(screen.queryByText(/%/)).toBeNull();
});

it('formats a duration the way a clock reads it', () => {
  expect(formatClock(5)).toBe('0:05');
  expect(formatClock(125.4)).toBe('2:05');
  expect(formatClock(3725)).toBe('1:02:05');
  expect(formatClock(-3)).toBe('0:00');
});

it('adds the time left after the percent once it is known', () => {
  render(<BusyLabel label="Generating…" progress={0.42} eta={80} />);
  expect(screen.getByText('42%')).toBeInTheDocument();
  expect(screen.getByText('· common.time_left:1:20')).toBeInTheDocument();
  cleanup();
  render(<BusyLabel label="Generating…" progress={0.42} eta={null} />);
  expect(document.querySelector('[data-slot="busy-eta"]')).toBeNull();
});

/** Drive useEta through progress samples taken `step` seconds apart. */
function etaAfter(samples: (number | null)[], step: number, options?: { resetKey?: unknown }) {
  vi.useFakeTimers({ now: 0 });
  const hook = renderHook(
    ({ p, key }: { p: number | null; key?: unknown }) =>
      useEta(p, { running: true, resetKey: key }),
    { initialProps: { p: samples[0], key: options?.resetKey } },
  );
  for (const p of samples.slice(1)) {
    act(() => {
      vi.advanceTimersByTime(step * 1000);
    });
    hook.rerender({ p, key: options?.resetKey });
  }
  return hook;
}

it('shows no time left until progress has moved enough for long enough', () => {
  expect(etaAfter([0.1, 0.12], 10).result.current).toBeNull(); // moved 2 %
  expect(etaAfter([0.1, 0.2], 2).result.current).toBeNull(); // only 2 s
  expect(etaAfter([null, null], 30).result.current).toBeNull(); // no number at all
});

it('times the rate from where progress first moved, not from the job start', () => {
  // 10 -> 20 -> 30 % in 10 s steps: 70 % left at 1 % a second.
  expect(etaAfter([0.1, 0.2, 0.3], 10).result.current).toBe(70);
});

it('does not read an engine start as a slow rate', () => {
  // Music: 0 % for a minute while the server starts, then 10 %, then 10 % every 10 s. Timing
  // from the start would say ~8 minutes; the real answer is 70 s.
  const { result } = etaAfter([0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3], 10);
  expect(result.current).toBe(70);
});

it('counts down between updates and goes quiet past the estimate', () => {
  const { result } = etaAfter([0, 0.25, 0.5], 10); // 25 % per 10 s from 25 %: 20 s left
  expect(result.current).toBe(20);
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  expect(result.current).toBe(16);
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  expect(result.current).toBeNull();
});

it('starts over when the stage changes or progress goes backwards', () => {
  const hook = etaAfter([0, 0.25, 0.5], 10, { resetKey: 'loading' });
  expect(hook.result.current).toBe(20);
  hook.rerender({ p: 0.5, key: 'generating' });
  expect(hook.result.current).toBeNull();
  const back = etaAfter([0, 0.25, 0.5, 0.1], 10);
  expect(back.result.current).toBeNull();
});
