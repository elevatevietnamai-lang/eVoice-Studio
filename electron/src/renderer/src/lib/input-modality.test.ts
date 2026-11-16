import { afterEach, expect, it } from 'vitest';
import { installInputModality } from './input-modality';

let uninstall: () => void = () => {};
afterEach(() => uninstall());

it('marks the page by the last kind of input', () => {
  uninstall = installInputModality();
  const root = document.documentElement;
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(root.dataset.inputModality).toBe('pointer');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(root.dataset.inputModality).toBe('keyboard');
});

it('ignores shortcut chords, which do not move focus', () => {
  uninstall = installInputModality();
  const root = document.documentElement;
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
  );
  expect(root.dataset.inputModality).toBe('pointer');
});

it('removes its mark when uninstalled', () => {
  const stop = installInputModality();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  stop();
  expect(document.documentElement.dataset.inputModality).toBeUndefined();
});
