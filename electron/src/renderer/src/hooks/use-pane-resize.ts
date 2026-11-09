import { useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';

export function usePaneResize({
  storageKey,
  side,
  minimum = 280,
  initial = 360,
  maximum = Infinity,
  reserve = 320,
  enabled = true,
}: {
  storageKey: string;
  side: 'left' | 'right';
  minimum?: number;
  initial?: number;
  maximum?: number;
  reserve?: number;
  enabled?: boolean;
}) {
  const host = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  // True while the handle is dragged, so width transitions can switch off and follow the pointer.
  const [resizing, setResizing] = useState(false);
  const [limit, setLimit] = useState(initial);
  const [preferred, setPreferred] = useState(() => {
    try {
      const width = Number(localStorage.getItem(storageKey));
      return Number.isFinite(width) && width >= minimum ? width : initial;
    } catch {
      return initial;
    }
  });
  const width = Math.max(minimum, Math.min(preferred, limit));
  useLayoutEffect(() => {
    let parent = host.current?.parentElement ?? null;
    while (
      parent &&
      (parent.clientWidth === 0 ||
        // The shell's panel column is as wide as the panel itself; measure the window row instead.
        parent.hasAttribute('data-panel-slot') ||
        window.getComputedStyle(parent).display === 'contents')
    )
      parent = parent.parentElement;
    const pane = host.current;
    if (!enabled || !parent || !pane) return;
    // Room from the pane's own left edge to the row's right edge: in the shell row that leaves out
    // the rail and the main sidebar, so the pane never eats the content's reserved width.
    const measure = () => {
      const offset = pane.getBoundingClientRect().left - parent.getBoundingClientRect().left;
      setLimit(Math.max(minimum, Math.min(maximum, parent.clientWidth - offset - reserve)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    // Dragging the main sidebar moves the pane without resizing the row; the content sees it.
    const content = document.querySelector('[data-slot="workspace-content"]');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, maximum, minimum, reserve]);
  const resize = (value: number) => {
    const next = Math.max(minimum, Math.min(value, limit));
    setPreferred(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      /* Session layout remains usable. */
    }
  };
  const separatorProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuemin': minimum,
    'aria-valuemax': limit,
    'aria-valuenow': width,
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width };
      setResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      if (drag.current)
        resize(drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1));
    },
    onPointerUp: (event) => {
      drag.current = null;
      setResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => {
      drag.current = null;
      setResizing(false);
    },
    onLostPointerCapture: () => {
      drag.current = null;
      setResizing(false);
    },
    onDoubleClick: () => resize(initial),
    onKeyDown: (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        resize(width + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1));
      }
    },
  };
  return { host, width, resizing, separatorProps };
}
