import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EVoiceMark, FULL, SMALL } from './evoice-mark';

afterEach(cleanup);

it('is decorative by default and named when given a label', () => {
  const { container, rerender } = render(<EVoiceMark />);
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  rerender(<EVoiceMark label="eVoice Studio" />);
  expect(screen.getByRole('img', { name: 'eVoice Studio' })).toBeTruthy();
});

it('uses the small cut at 32 px and below and the full mark above', () => {
  const { container, rerender } = render(<EVoiceMark size={24} />);
  expect(container.querySelector('svg')?.dataset.mark).toBe('small');
  rerender(<EVoiceMark size={32} />);
  expect(container.querySelector('svg')?.dataset.mark).toBe('small');
  rerender(<EVoiceMark size={64} />);
  expect(container.querySelector('svg')?.dataset.mark).toBe('full');
});

it('keeps the app icon drawing at small sizes when asked for the full cut', () => {
  const { container } = render(<EVoiceMark size={26} cut="full" />);
  expect(container.querySelector('svg')?.dataset.mark).toBe('full');
  expect(container.querySelector('path')?.getAttribute('stroke-width')).toBe('17');
});

it('draws only with currentColor and never fills the waveform', () => {
  const { container } = render(<EVoiceMark size={64} />);
  const path = container.querySelector('path')!;
  expect(path.getAttribute('fill')).toBe('none');
  expect(path.getAttribute('stroke')).toBe('currentColor');
  expect(container.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
});

/** Ink box centre and stroke-weighted centroid of a cut, sampling its cubic segments densely. */
function measure(cut: typeof FULL) {
  const n = cut.wave.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  let [x0, y0] = n;
  let length = 0;
  let sx = 0;
  let sy = 0;
  const xs = [cut.dot.cx - cut.dot.r];
  const ys = [cut.dot.cy - cut.dot.r, cut.dot.cy + cut.dot.r];
  for (let i = 2; i < n.length; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = n.slice(i, i + 6);
    let px = x0;
    let py = y0;
    for (let step = 1; step <= 400; step++) {
      const t = step / 400;
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
      const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
      const d = Math.hypot(x - px, y - py);
      length += d;
      sx += ((x + px) / 2) * d;
      sy += ((y + py) / 2) * d;
      xs.push(x);
      ys.push(y);
      px = x;
      py = y;
    }
    [x0, y0] = [x3, y3];
  }
  const half = cut.stroke / 2;
  const wave = length * cut.stroke;
  const dot = Math.PI * cut.dot.r ** 2;
  const massX = ((sx / length) * wave + cut.dot.cx * dot) / (wave + dot);
  const massY = ((sy / length) * wave + cut.dot.cy * dot) / (wave + dot);
  const boxX = (Math.min(...xs) + Math.max(...xs) + half) / 2;
  const boxY = (Math.min(...ys) - half + Math.max(...ys) + half) / 2;
  return { x: (boxX + massX) / 2 + cut.shift.x, y: (boxY + massY) / 2 + cut.shift.y };
}

it.each([
  ['full', FULL],
  ['small', SMALL],
])('sits the %s cut on its optical centre, within 2 units of 256', (_name, cut) => {
  const centre = measure(cut);
  expect(Math.abs(centre.x - 128)).toBeLessThan(2);
  expect(Math.abs(centre.y - 128)).toBeLessThan(2);
});
