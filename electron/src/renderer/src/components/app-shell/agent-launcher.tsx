import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motionTokens } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const LAUNCHER_POSITION_KEY = 'voicestudio.agent-launcher-position';
/** The launcher is `size-11`. */
const SIZE = 44;
/** Space kept between the launcher and the window edge. */
const MARGIN = 12;
/** The pane headers form the native title bar (`.workspace-titlebar`, 52 px): never cover it. */
const TITLEBAR = 52;
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 4;
/** Alt+arrow moves the launcher this far along its edge, for people who do not drag. */
const KEY_STEP = 48;

export type LauncherEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * Where the launcher rests: one of the window's four edges, and how far along it its centre sits
 * (0 = top or left end, 1 = bottom or right end). Kept relative, so it stays on its edge when
 * the window resizes.
 */
export interface LauncherSpot {
  edge: LauncherEdge;
  at: number;
}

const DEFAULT_SPOT: LauncherSpot = { edge: 'right', at: 0.5 };
const EDGES: readonly LauncherEdge[] = ['left', 'right', 'top', 'bottom'];
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

/** The saved spot, or the default: the right edge, halfway down. */
export function loadLauncherSpot(): LauncherSpot {
  try {
    const saved = JSON.parse(localStorage.getItem(LAUNCHER_POSITION_KEY) ?? 'null') as {
      edge?: unknown;
      at?: unknown;
    } | null;
    if (
      saved &&
      EDGES.includes(saved.edge as LauncherEdge) &&
      typeof saved.at === 'number' &&
      Number.isFinite(saved.at)
    )
      return { edge: saved.edge as LauncherEdge, at: clampUnit(saved.at) };
  } catch {
    // A damaged value falls back to the default.
  }
  return DEFAULT_SPOT;
}

function saveLauncherSpot(spot: LauncherSpot): void {
  try {
    localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(spot));
  } catch {
    // Without storage the launcher stays where it was put until the app restarts.
  }
}

/** The area the launcher may occupy: inside the window margin and below the title bar. */
function bounds(width: number, height: number) {
  const minLeft = MARGIN;
  const minTop = TITLEBAR + MARGIN;
  return {
    minLeft,
    minTop,
    maxLeft: Math.max(minLeft, width - SIZE - MARGIN),
    maxTop: Math.max(minTop, height - SIZE - MARGIN),
  };
}

/** Top-left corner of the launcher resting at `spot` in a `width` × `height` window. */
export function placeLauncher(
  spot: LauncherSpot,
  width: number,
  height: number,
): { left: number; top: number } {
  const box = bounds(width, height);
  const along = (min: number, max: number) =>
    Math.min(max, Math.max(min, min + spot.at * (max - min)));
  switch (spot.edge) {
    case 'left':
      return { left: box.minLeft, top: along(box.minTop, box.maxTop) };
    case 'right':
      return { left: box.maxLeft, top: along(box.minTop, box.maxTop) };
    case 'top':
      return { left: along(box.minLeft, box.maxLeft), top: box.minTop };
    case 'bottom':
      return { left: along(box.minLeft, box.maxLeft), top: box.maxTop };
  }
}

/** The spot on the edge nearest to a launcher dropped at `left`, `top`: it snaps there. */
export function nearestSpot(
  left: number,
  top: number,
  width: number,
  height: number,
): LauncherSpot {
  const box = bounds(width, height);
  const x = Math.min(box.maxLeft, Math.max(box.minLeft, left));
  const y = Math.min(box.maxTop, Math.max(box.minTop, top));
  const distance: Record<LauncherEdge, number> = {
    left: x - box.minLeft,
    right: box.maxLeft - x,
    top: y - box.minTop,
    bottom: box.maxTop - y,
  };
  const edge = EDGES.reduce((best, next) => (distance[next] < distance[best] ? next : best));
  const fraction = (value: number, min: number, max: number) =>
    max > min ? clampUnit((value - min) / (max - min)) : 0.5;
  return {
    edge,
    at:
      edge === 'left' || edge === 'right'
        ? fraction(y, box.minTop, box.maxTop)
        : fraction(x, box.minLeft, box.maxLeft),
  };
}

/** Alt+arrow: along the edge moves the launcher; across it jumps to that edge. */
export function stepSpot(
  spot: LauncherSpot,
  key: string,
  width: number,
  height: number,
): LauncherSpot | null {
  const box = bounds(width, height);
  const vertical = spot.edge === 'left' || spot.edge === 'right';
  const stepX = KEY_STEP / Math.max(1, box.maxLeft - box.minLeft);
  const stepY = KEY_STEP / Math.max(1, box.maxTop - box.minTop);
  switch (key) {
    case 'ArrowUp':
      return vertical ? { ...spot, at: clampUnit(spot.at - stepY) } : { ...spot, edge: 'top' };
    case 'ArrowDown':
      return vertical ? { ...spot, at: clampUnit(spot.at + stepY) } : { ...spot, edge: 'bottom' };
    case 'ArrowLeft':
      return vertical ? { ...spot, edge: 'left' } : { ...spot, at: clampUnit(spot.at - stepX) };
    case 'ArrowRight':
      return vertical ? { ...spot, edge: 'right' } : { ...spot, at: clampUnit(spot.at + stepX) };
    default:
      return null;
  }
}

function useWindowSize() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/**
 * The floating Agent button. It scales and fades in and out (DESIGN.md: overlays fade and
 * scale). It can be dragged anywhere and snaps to the nearest of the window's four edges when
 * dropped, or moved with Alt+arrows; the spot is remembered on this computer.
 */
export function AgentLauncher({ running, onOpen }: { running: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { width, height } = useWindowSize();
  const [spot, setSpot] = useState<LauncherSpot>(loadLauncherSpot);
  // While dragging, the launcher follows the pointer freely; on drop it snaps to an edge.
  const [free, setFree] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{
    pointer: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
    last: { left: number; top: number };
  } | null>(null);
  // The click that ends a drag must not open the dock.
  const dragged = useRef(false);
  const rest = placeLauncher(spot, width, height);
  const { left, top } = free ?? rest;

  const settle = (next: LauncherSpot) => {
    setSpot(next);
    saveLauncherSpot(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    drag.current = {
      pointer: event.pointerId,
      offsetX: event.clientX - left,
      offsetY: event.clientY - top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      last: { left, top },
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (
      !current.moved &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD
    )
      return;
    current.moved = true;
    const box = bounds(width, height);
    current.last = {
      left: Math.min(box.maxLeft, Math.max(box.minLeft, event.clientX - current.offsetX)),
      top: Math.min(box.maxTop, Math.max(box.minTop, event.clientY - current.offsetY)),
    };
    setFree(current.last);
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) return;
    dragged.current = event.type === 'pointerup';
    // A cancelled pointer reports no usable position: snap from the last place it was moved to.
    settle(nearestSpot(current.last.left, current.last.top, width, height));
    setFree(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return;
    const next = stepSpot(spot, event.key, width, height);
    if (!next) return;
    event.preventDefault();
    settle(next);
  };

  const hint = t('repairAgent.launcherHint');
  return (
    <motion.div
      data-slot="agent-launcher"
      data-edge={spot.edge}
      className={cn(
        'fixed z-40 [-webkit-app-region:no-drag]',
        // Snapping to an edge glides; following the pointer does not lag behind it.
        !free &&
          'transition-[left,top] duration-(--motion-base) ease-(--ease-standard) motion-reduce:transition-none',
      )}
      style={{ left, top }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: motionTokens.base, ease: motionTokens.ease },
      }}
      exit={
        reduced
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { opacity: 0, scale: 0.85, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }
      }
    >
      <Button
        size="icon"
        variant="secondary"
        aria-label={t('repairAgent.title')}
        aria-description={hint}
        title={`${t('repairAgent.title')}\n${hint}`}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onOpen();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(
          'relative size-11 touch-none rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg',
          free ? 'cursor-grabbing shadow-xl' : 'cursor-pointer',
        )}
      >
        <BotIcon />
        {running && <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />}
      </Button>
    </motion.div>
  );
}
