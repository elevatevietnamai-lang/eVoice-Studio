import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentLauncher,
  LAUNCHER_POSITION_KEY,
  loadLauncherSpot,
  nearestSpot,
  placeLauncher,
  stepSpot,
} from './agent-launcher';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

/** jsdom has no PointerEvent: a MouseEvent of the pointer type carries the coordinates. */
function pointer(target: Element, type: string, x: number, y: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

// A 1000 × 800 window: left runs 12..944, top runs 64 (under the 52 px title bar)..744.
const W = 1000;
const H = 800;

beforeEach(() => {
  localStorage.clear();
  Object.assign(window, { innerWidth: W, innerHeight: H });
});
afterEach(() => localStorage.clear());

describe('agent launcher placement', () => {
  it('rests on the right edge, halfway down, until it is moved', () => {
    expect(loadLauncherSpot()).toEqual({ edge: 'right', at: 0.5 });
    expect(placeLauncher({ edge: 'right', at: 0.5 }, W, H)).toEqual({ left: 944, top: 404 });
  });

  it('places each edge flush with the window margin and below the title bar', () => {
    expect(placeLauncher({ edge: 'left', at: 0 }, W, H)).toEqual({ left: 12, top: 64 });
    expect(placeLauncher({ edge: 'top', at: 1 }, W, H)).toEqual({ left: 944, top: 64 });
    expect(placeLauncher({ edge: 'bottom', at: 0 }, W, H)).toEqual({ left: 12, top: 744 });
  });

  it('snaps a drop to the nearest of the four edges', () => {
    expect(nearestSpot(40, 400, W, H).edge).toBe('left');
    expect(nearestSpot(900, 400, W, H).edge).toBe('right');
    expect(nearestSpot(500, 80, W, H)).toEqual({ edge: 'top', at: (500 - 12) / 932 });
    expect(nearestSpot(500, 730, W, H).edge).toBe('bottom');
  });

  it('stays on its edge when the window resizes', () => {
    const spot = nearestSpot(944, 404, W, H);
    expect(placeLauncher(spot, 600, 500).left).toBe(600 - 44 - 12);
  });

  it('moves along its edge with Alt+arrows and jumps across to another edge', () => {
    expect(stepSpot({ edge: 'right', at: 0.5 }, 'ArrowLeft', W, H)).toEqual({ edge: 'left', at: 0.5 });
    expect(stepSpot({ edge: 'right', at: 0.5 }, 'ArrowUp', W, H)!.at).toBeLessThan(0.5);
    expect(stepSpot({ edge: 'top', at: 0.5 }, 'ArrowDown', W, H)).toEqual({ edge: 'bottom', at: 0.5 });
    expect(stepSpot({ edge: 'top', at: 0 }, 'ArrowLeft', W, H)).toEqual({ edge: 'top', at: 0 });
    expect(stepSpot({ edge: 'top', at: 0 }, 'Enter', W, H)).toBeNull();
  });

  it('ignores a damaged saved spot', () => {
    localStorage.setItem(LAUNCHER_POSITION_KEY, '{"edge":"middle","at":0.2}');
    expect(loadLauncherSpot()).toEqual({ edge: 'right', at: 0.5 });
    localStorage.setItem(LAUNCHER_POSITION_KEY, 'not json');
    expect(loadLauncherSpot()).toEqual({ edge: 'right', at: 0.5 });
  });
});

describe('AgentLauncher', () => {
  const launcher = () => screen.getByRole('button', { name: 'repairAgent.title' });
  const frame = () => launcher().closest('[data-slot="agent-launcher"]') as HTMLElement;

  it('opens the dock on a click', () => {
    const onOpen = vi.fn();
    render(<AgentLauncher running={false} onOpen={onOpen} />);
    fireEvent.click(launcher());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('follows a drag, snaps to the nearest edge on the drop, remembers it, and does not open', () => {
    const onOpen = vi.fn();
    render(<AgentLauncher running={false} onOpen={onOpen} />);
    const button = launcher();
    // Grab the centre of the default spot (944, 404) + 22, carry it near the bottom edge.
    pointer(button, 'pointerdown', 966, 426);
    pointer(button, 'pointermove', 500, 600);
    expect(frame().style.left).toBe('478px');
    expect(frame().style.top).toBe('578px');
    pointer(button, 'pointermove', 500, 740);
    pointer(button, 'pointerup', 500, 740);
    fireEvent.click(button);

    expect(onOpen).not.toHaveBeenCalled();
    expect(frame().dataset.edge).toBe('bottom');
    expect(frame().style.top).toBe('744px');
    expect(frame().style.left).toBe('478px');
    expect(loadLauncherSpot().edge).toBe('bottom');
  });

  it('treats a press that barely moves as a click', () => {
    const onOpen = vi.fn();
    render(<AgentLauncher running={false} onOpen={onOpen} />);
    const button = launcher();
    pointer(button, 'pointerdown', 966, 426);
    pointer(button, 'pointermove', 968, 427);
    pointer(button, 'pointerup', 968, 427);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(localStorage.getItem(LAUNCHER_POSITION_KEY)).toBeNull();
  });

  it('moves with Alt+arrow keys for people who do not drag', () => {
    render(<AgentLauncher running={false} onOpen={() => {}} />);
    fireEvent.keyDown(launcher(), { key: 'ArrowLeft', altKey: true });
    expect(frame().dataset.edge).toBe('left');
    expect(frame().style.left).toBe('12px');
    expect(loadLauncherSpot()).toEqual({ edge: 'left', at: 0.5 });
  });

  it('starts where it was left', () => {
    localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify({ edge: 'top', at: 0 }));
    render(<AgentLauncher running={false} onOpen={() => {}} />);
    expect(frame().style.left).toBe('12px');
    expect(frame().style.top).toBe('64px');
  });
});
