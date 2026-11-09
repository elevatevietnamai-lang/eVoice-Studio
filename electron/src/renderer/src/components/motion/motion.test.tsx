import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FadeIn, MotionProvider, Stagger, StaggerItem, motionTokens } from './index';

afterEach(cleanup);

it('uses the Elevate timing tokens (160, 240 and 480 ms)', () => {
  expect(motionTokens.fast).toBe(0.16);
  expect(motionTokens.base).toBe(0.24);
  expect(motionTokens.slow).toBe(0.48);
  expect(motionTokens.ease).toEqual([0.22, 1, 0.36, 1]);
});

it('renders content inside the provider, fade and stagger wrappers', () => {
  render(
    <MotionProvider>
      <FadeIn direction="none">
        <p>faded</p>
      </FadeIn>
      <Stagger>
        <StaggerItem>
          <p>first</p>
        </StaggerItem>
        <StaggerItem>
          <p>second</p>
        </StaggerItem>
      </Stagger>
    </MotionProvider>,
  );
  for (const text of ['faded', 'first', 'second']) expect(screen.getByText(text)).toBeTruthy();
});
