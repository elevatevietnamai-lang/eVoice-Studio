import { useSyncExternalStore } from 'react';

/**
 * Playhead time and play state, outside React state so the clock can tick
 * every frame without re-rendering the whole promo page: only the playhead,
 * the time readout and the preview subscribe.
 */
export interface Playhead {
  get(): { time: number; playing: boolean };
  seek(time: number): void;
  setPlaying(playing: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createPlayhead(): Playhead {
  let state = { time: 0, playing: false };
  const listeners = new Set<() => void>();
  const emit = (next: typeof state) => {
    if (next.time === state.time && next.playing === state.playing) return;
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    seek: (time) => emit({ ...state, time: Math.max(0, time) }),
    setPlaying: (playing) => emit({ ...state, playing }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePlayhead(playhead: Playhead) {
  return useSyncExternalStore(playhead.subscribe, playhead.get, playhead.get);
}
