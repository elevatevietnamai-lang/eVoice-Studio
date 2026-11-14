import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installDetailsMotion } from './details-motion';

type FakeAnimation = { onfinish: (() => void) | null; oncancel: (() => void) | null; cancel: () => void };

let cleanup: () => void;
let animations: FakeAnimation[];

function card(extra = '') {
  document.body.innerHTML = `<details ${extra}><summary>Title <button type="button">Edit</button></summary><p>Body</p></details>`;
  const details = document.querySelector('details')!;
  details.animate = vi.fn(() => {
    const animation: FakeAnimation = { onfinish: null, oncancel: null, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  return details;
}

beforeEach(() => {
  animations = [];
  cleanup = installDetailsMotion();
});
afterEach(() => cleanup());

it('opens at once and animates the height', () => {
  const details = card();
  details.querySelector('summary')!.click();
  expect(details.open).toBe(true);
  expect(details.animate).toHaveBeenCalledTimes(1);
});

it('stays open until the closing animation finishes, then closes', () => {
  const details = card('open');
  details.querySelector('summary')!.click();
  expect(details.open).toBe(true);
  expect(details.dataset.closing).toBe('true');
  animations[0].onfinish?.();
  expect(details.open).toBe(false);
});

it('reverses when clicked while closing', () => {
  const details = card('open');
  const summary = details.querySelector('summary')!;
  summary.click();
  summary.click();
  expect(animations[0].cancel).toHaveBeenCalled();
  animations[0].onfinish?.();
  expect(details.open).toBe(true);
});

it('leaves a control inside the summary alone', () => {
  const details = card();
  details.querySelector('button')!.click();
  expect(details.animate).not.toHaveBeenCalled();
});

it('honours data-motion="none"', () => {
  const details = card('data-motion="none"');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  details.querySelector('summary')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(details.animate).not.toHaveBeenCalled();
});

it('closes to the measured closed height, so a card whose summary has a margin does not jump back', () => {
  // A `space-y-3` card: the summary keeps a 12 px bottom margin when closed, which a sum of
  // summary height, padding and border misses (the card shrank past 53 px, then snapped back).
  const details = card('open class="space-y-3"');
  details.getBoundingClientRect = () => ({ height: details.open ? 277 : 53 }) as DOMRect;
  details.querySelector('summary')!.click();
  const keyframes = vi.mocked(details.animate).mock.calls[0][0] as Keyframe[];
  expect(keyframes).toEqual([{ height: '277px' }, { height: '53px' }]);
  expect(details.open).toBe(true);
});
