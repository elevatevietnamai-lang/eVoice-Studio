import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EVoiceMark } from './evoice-mark';

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

it('draws only with currentColor and never fills the waveform', () => {
  const { container } = render(<EVoiceMark size={64} />);
  const path = container.querySelector('path')!;
  expect(path.getAttribute('fill')).toBe('none');
  expect(path.getAttribute('stroke')).toBe('currentColor');
  expect(container.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
});
