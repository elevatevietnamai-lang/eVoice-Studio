import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api/client';
import type { PromoDraft, PromoMedia } from './promo-model';

/** The music's beat grid as `/promo/render` uses it (`GET /promo/beats/{id}`). */
export interface BeatGrid {
  period: number;
  phase: number;
}

export const NO_GRID: BeatGrid = { period: 0, phase: 0 };

export function useBeatGrid(music: PromoMedia | null): BeatGrid {
  const [grid, setGrid] = useState<BeatGrid>(NO_GRID);
  useEffect(() => {
    setGrid(NO_GRID);
    if (!music) return;
    let active = true;
    apiJson<BeatGrid>(`/promo/beats/${encodeURIComponent(music.id)}`).then(
      (value) => active && setGrid({ period: value.period || 0, phase: value.phase || 0 }),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [music]);
  return grid;
}

/** Whether the render will snap cuts to beats (mirrors the router's condition). */
export function beatSyncActive(draft: PromoDraft, grid: BeatGrid): boolean {
  return draft.snapToBeats && !!draft.music && grid.period > 0 && draft.shots.length > 1;
}

/**
 * Seconds into the music file at video time 0. With beat sync the render
 * starts the music on a beat (`music_start + phase`), so beats fall at
 * multiples of the period in the video; otherwise it starts at 0.
 */
export function musicOffset(draft: PromoDraft, grid: BeatGrid): number {
  return beatSyncActive(draft, grid) ? grid.phase : 0;
}
