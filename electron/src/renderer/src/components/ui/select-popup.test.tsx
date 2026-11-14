import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { menuItemClass } from '@/components/menu-popup';
import { SimpleSelect } from '@/components/simple-select';

const rendererSources = import.meta.glob('../../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

afterEach(cleanup);

const ITEMS = [
  { value: 'auto', label: 'Auto' },
  { value: 'mono', label: 'Mono' },
  { value: 'stereo', label: 'Stereo' },
] as const;

function openSelect() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
  const onValueChange = vi.fn();
  render(<SimpleSelect value="auto" items={ITEMS} onValueChange={onValueChange} label="Channels" />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Channels' }));
  return onValueChange;
}

it('drops the list below the trigger instead of laying the selected item over it', async () => {
  openSelect();
  const listbox = await screen.findByRole('listbox');
  const positioner = listbox.closest('[data-side]') ?? listbox.parentElement!;
  // alignItemWithTrigger reports side "none"; an anchored list reports "bottom" (or "top" on flip).
  await waitFor(() => expect(positioner.getAttribute('data-side')).toBe('bottom'));
  const popup = document.querySelector('[data-slot="select-content"]')!;
  expect(popup.className).toContain('min-w-[max(var(--anchor-width),8rem)]');
  expect(popup.className).toContain('max-w-(--available-width)');
  expect(popup.className).toContain('p-1');
});

it('highlights the item under the pointer with the flat accent fill and still picks it', async () => {
  const onValueChange = openSelect();
  const mono = await screen.findByRole('option', { name: 'Mono' });
  expect(mono.className).toContain('data-highlighted:bg-accent');
  expect(mono.className).toContain('rounded-lg');
  expect(mono.className).not.toMatch(/(^|\s)focus:bg-/);
  fireEvent.mouseMove(mono);
  await waitFor(() => expect(mono).toHaveAttribute('data-highlighted'));
  fireEvent.pointerDown(mono, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseDown(mono, { button: 0 });
  fireEvent.pointerUp(mono, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseUp(mono, { button: 0 });
  fireEvent.click(mono);
  await waitFor(() => expect(onValueChange).toHaveBeenCalledWith('mono'));
});

/**
 * Base UI marks the hovered or keyboard-active item with `data-highlighted`; a `focus:` or
 * `hover:` fill misses keyboard moves or lags the pointer. Menu rows share `menuItemClass`,
 * which lights on `data-highlighted`, so no call site hand-builds a row.
 */
it('gives every Menu item the shared highlighted row class', () => {
  expect(menuItemClass).toContain('data-highlighted:bg-accent');
  expect(menuItemClass).toContain('rounded-lg');
  const offenders: string[] = [];
  for (const [path, source] of Object.entries(rendererSources)) {
    if (path.endsWith('.test.tsx')) continue;
    for (const match of source.matchAll(/<Menu\.(?:Radio|Checkbox)?Item\b/g)) {
      // The item's own className comes before its children close it.
      const end = source.indexOf('</Menu.', match.index);
      const item = source.slice(match.index, end < 0 ? undefined : end);
      if (!/className=\{(?:cn\()?menuItemClass\b/.test(item)) {
        offenders.push(`${path}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
