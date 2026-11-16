/** `m:ss.t` (or `m:ss`) for a time in seconds. */
export function formatTime(seconds: number, tenths = true): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const whole = Math.floor(rest);
  const base = `${minutes}:${String(whole).padStart(2, '0')}`;
  return tenths ? `${base}.${Math.floor((rest - whole) * 10)}` : base;
}

/** Undo/redo as snapshots of an immutable value. */
export interface History<T> {
  past: T[];
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function record<T>(history: History<T>, previous: T): History<T> {
  return { past: [...history.past, previous].slice(-HISTORY_LIMIT), future: [] };
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const previous = history.past.at(-1);
  if (previous === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, value: previous };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  const [next, ...rest] = history.future;
  if (next === undefined) return null;
  return { history: { past: [...history.past, current], future: rest }, value: next };
}
