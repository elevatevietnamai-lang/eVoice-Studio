import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { POPUP_EXIT_MS, usePresence } from './use-presence';

/**
 * Hand-built popups used to unmount the moment they closed, so they vanished with no exit
 * motion while every Base UI popup faded out. `usePresence` keeps them for the exit.
 */
const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function Popup({ open }: { open: boolean }) {
  const presence = usePresence(open);
  return presence.mounted ? (
    <div role="menu" aria-label="Menu" {...presence.props} data-testid="popup" />
  ) : null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps a closing popup mounted for its exit, hidden and inert, then removes it', () => {
  vi.useFakeTimers();
  const view = render(<Popup open />);
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
  view.rerender(<Popup open={false} />);
  const closing = screen.getByTestId('popup');
  expect(closing).toHaveAttribute('data-state', 'closed');
  expect(closing).toHaveAttribute('inert');
  expect(screen.queryByRole('menu')).toBeNull();
  act(() => vi.advanceTimersByTime(POPUP_EXIT_MS));
  expect(screen.queryByTestId('popup')).toBeNull();
});

it('gives every hand-built menu an exit through usePresence', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  const hits = Object.entries(sources)
    .filter(([file, source]) => !file.includes('/components/ui/') && /role="menu"/.test(source))
    .filter(([, source]) => !/usePresence\(/.test(source))
    .map(([file]) => file);
  expect(hits).toEqual([]);
});
