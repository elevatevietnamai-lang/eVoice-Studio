import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The OS asks for reduced motion before `motion` reads it (it caches the first answer).
vi.stubGlobal(
  'matchMedia',
  (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList,
);

const { MotionProvider, Reveal } = await import('./index');

afterEach(cleanup);

/**
 * `reducedMotion="user"` only drops transforms, so Reveal kept opening by height and pushed the
 * content around it for people who asked for no movement (DESIGN.md: reduced motion drops height).
 */
it('fades a revealed block in without a height change under reduced motion', () => {
  const view = render(
    <MotionProvider>
      <Reveal>{false && <p>Saved</p>}</Reveal>
    </MotionProvider>,
  );
  view.rerender(
    <MotionProvider>
      <Reveal>{true && <p>Saved</p>}</Reveal>
    </MotionProvider>,
  );
  const block = screen.getByText('Saved').parentElement!;
  expect(block.style.opacity).toBe('0');
  expect(block.style.height).toBe('');
});
