/**
 * The promo timeline is a view over PromoDraft: layout reads the draft, and
 * every edit is a pure `draft → draft` function, so the shot list, the render
 * request and the saved draft stay the single source of truth. Start times
 * come from `timeline()`, which mirrors the backend's segment_starts.
 */
import {
  anchorIndex,
  clampTransition,
  MAX_SHOT_SECONDS,
  MAX_SHOTS,
  MIN_SHOT_SECONDS,
  overlayProblem,
  timeline,
  type PromoDraft,
  type PromoOverlay,
  type PromoShot,
} from './promo-model';

export interface ShotBlock {
  key: string;
  index: number;
  start: number;
  end: number;
  shot: PromoShot;
}

export interface OverlayBlock {
  key: string;
  start: number;
  end: number;
  /** Row in the overlay track; overlapping overlays stack. */
  lane: number;
  anchored: boolean;
  problem: ReturnType<typeof overlayProblem>;
  overlay: PromoOverlay;
}

export interface TimelineLayout {
  shots: ShotBlock[];
  outro: { start: number; end: number } | null;
  overlays: OverlayBlock[];
  lanes: number;
  length: number;
}

/**
 * Milliseconds, rounded like Python's round(x, 3): on the exact binary value
 * (5 × 0.5221 is 2.61049…, so 2.61), not after multiplying by 1000 (2.611).
 * The backend's beat snapping must come out identical.
 */
const round = (value: number) => Number(value.toFixed(3));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Absolute start of an overlay in the finished video. */
export function overlayStart(draft: PromoDraft, overlay: PromoOverlay): number {
  const index = anchorIndex(draft, overlay);
  return index >= 0 ? timeline(draft).starts[index] + overlay.start : overlay.start;
}

export function layoutTimeline(draft: PromoDraft): TimelineLayout {
  const { starts, length } = timeline(draft);
  const shots = draft.shots.map((shot, index) => ({
    key: shot.key,
    index,
    start: starts[index],
    end: round(starts[index] + shot.duration),
    shot,
  }));
  const outro =
    starts.length > draft.shots.length && draft.shots.length
      ? { start: starts[draft.shots.length], end: length }
      : null;
  // Greedy interval partitioning: each overlay takes the first lane free at its start.
  const laneEnds: number[] = [];
  const overlays = draft.overlays
    .map((overlay) => {
      const start = overlayStart(draft, overlay);
      return { overlay, start, end: start + (overlay.media.duration ?? 1) };
    })
    .sort((a, b) => a.start - b.start)
    .map(({ overlay, start, end }) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start + 1e-6);
      if (lane < 0) lane = laneEnds.push(end) - 1;
      else laneEnds[lane] = end;
      return {
        key: overlay.key,
        start: round(start),
        end: round(end),
        lane,
        anchored: anchorIndex(draft, overlay) >= 0,
        problem: overlayProblem(draft, overlay),
        overlay,
      };
    });
  return { shots, outro, overlays, lanes: Math.max(1, laneEnds.length), length };
}

/**
 * The shot on screen at `time`: during a transition the incoming shot wins,
 * from its start. -1 before the first shot or from the logo ending on.
 */
export function shotAt(draft: PromoDraft, time: number): number {
  const { starts, length } = timeline(draft);
  if (!draft.shots.length || time < 0 || time >= length) return -1;
  const outroStart = starts.length > draft.shots.length ? starts[draft.shots.length] : Infinity;
  if (time >= outroStart) return -1;
  let found = 0;
  for (let index = 0; index < draft.shots.length; index++) if (starts[index] <= time) found = index;
  return found;
}

const withShot = (draft: PromoDraft, key: string, patch: (shot: PromoShot) => PromoShot) => ({
  ...draft,
  shots: draft.shots.map((shot) => (shot.key === key ? patch(shot) : shot)),
});

/** Longest a shot may run: the clip's remaining length for a video, the backend cap otherwise. */
export function maxDuration(shot: PromoShot): number {
  const left =
    shot.media.kind === 'video' && shot.media.duration
      ? shot.media.duration - shot.start
      : MAX_SHOT_SECONDS;
  // A clip already set longer than it runs keeps its length (the backend allows it).
  return round(
    clamp(
      Math.max(left, Math.min(shot.duration, MAX_SHOT_SECONDS)),
      MIN_SHOT_SECONDS,
      MAX_SHOT_SECONDS,
    ),
  );
}

/** Drag the right edge: a new length within the backend limits and the clip. */
export function resizeShot(draft: PromoDraft, key: string, duration: number): PromoDraft {
  return withShot(draft, key, (shot) => ({
    ...shot,
    duration: round(clamp(duration, MIN_SHOT_SECONDS, maxDuration(shot))),
  }));
}

/**
 * Drag the left edge of a video shot: the clip starts later (or earlier) and
 * the shot gets shorter (or longer) by the same amount, so its end stays put.
 */
export function trimShotStart(draft: PromoDraft, key: string, start: number): PromoDraft {
  return withShot(draft, key, (shot) => {
    if (shot.media.kind !== 'video') return shot;
    const end = shot.start + shot.duration;
    const next = clamp(start, Math.max(0, end - MAX_SHOT_SECONDS), end - MIN_SHOT_SECONDS);
    return { ...shot, start: round(next), duration: round(end - next) };
  });
}

/** Move a shot to `index` in the order; overlays anchored to it go along. */
export function moveShotTo(draft: PromoDraft, key: string, index: number): PromoDraft {
  const from = draft.shots.findIndex((shot) => shot.key === key);
  if (from < 0) return draft;
  const to = clamp(Math.round(index), 0, draft.shots.length - 1);
  if (to === from) return draft;
  const shots = draft.shots.slice();
  const [moved] = shots.splice(from, 1);
  shots.splice(to, 0, moved);
  return { ...draft, shots };
}

/**
 * Split the shot on screen at `time` into two. The second half is a cut that
 * continues the clip, and overlays anchored after the split point move to it.
 * Returns the draft unchanged when either half would be too short, or so
 * short that a neighbouring transition would shrink and move later cuts.
 */
export function splitShotAt(draft: PromoDraft, time: number, newKey: string): PromoDraft {
  if (draft.shots.length >= MAX_SHOTS) return draft;
  const index = shotAt(draft, time);
  if (index < 0) return draft;
  const shot = draft.shots[index];
  const local = round(time - timeline(draft).starts[index]);
  if (local < MIN_SHOT_SECONDS || shot.duration - local < MIN_SHOT_SECONDS) return draft;
  const first: PromoShot = { ...shot, duration: local };
  const second: PromoShot = {
    ...shot,
    key: newKey,
    start: shot.media.kind === 'video' ? round(shot.start + local) : 0,
    duration: round(shot.duration - local),
    transition: 'cut',
  };
  const shots = draft.shots.slice();
  shots.splice(index, 1, first, second);
  const overlays = draft.overlays.map((overlay) =>
    overlay.shotKey === shot.key && overlay.start >= local
      ? { ...overlay, shotKey: newKey, start: round(overlay.start - local) }
      : overlay,
  );
  const next = { ...draft, shots, overlays };
  // A split must not move anything: when a half is too short for a
  // transition next to it, the 45 % clamp would shorten that transition and
  // shift every later cut. Refuse the split instead.
  return Math.abs(timeline(next).length - timeline(draft).length) > 1e-6 ? draft : next;
}

/**
 * Drop an overlay at `time`: it anchors to the shot on screen there (so it
 * follows that shot through beat snapping and reordering), or counts from the
 * video start when dropped on the logo ending.
 */
export function moveOverlay(draft: PromoDraft, key: string, time: number): PromoDraft {
  const at = Math.max(0, round(time));
  const index = shotAt(draft, at);
  const starts = timeline(draft).starts;
  return {
    ...draft,
    overlays: draft.overlays.map((overlay) =>
      overlay.key !== key
        ? overlay
        : index >= 0
          ? { ...overlay, shotKey: draft.shots[index].key, start: round(at - starts[index]) }
          : { ...overlay, shotKey: null, start: at },
    ),
  };
}

export function removeShot(draft: PromoDraft, key: string): PromoDraft {
  return { ...draft, shots: draft.shots.filter((shot) => shot.key !== key) };
}

export function removeOverlay(draft: PromoDraft, key: string): PromoDraft {
  return { ...draft, overlays: draft.overlays.filter((overlay) => overlay.key !== key) };
}

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) > 1e-9) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The shot lengths `/promo/render` gives the draft with **Cut on the beat**:
 * a port of snap_to_beats in services/promo_video.py (each cut moves to the
 * nearest beat that keeps every shot at least MIN_SHOT_SECONDS; the last shot
 * keeps its length). Applying it while editing makes the timeline show what
 * renders: the backend leaves cuts already on the grid where they are.
 */
export function snapToBeats(draft: PromoDraft, period: number): PromoDraft {
  const durations = draft.shots.map((shot) => shot.duration);
  if (!(period > 0) || durations.length < 2) return draft;
  const overlaps = draft.shots.map((shot, index) =>
    index === 0 || shot.transition === 'cut'
      ? 0
      : clampTransition(shot.transitionSeconds, durations[index - 1], shot.duration),
  );
  const offsets = [0];
  let length = durations[0];
  for (let k = 1; k < durations.length; k++) {
    offsets.push(length - overlaps[k]);
    length += durations[k] - overlaps[k];
  }
  const snapped = [0];
  for (let k = 1; k < durations.length; k++) {
    const earliest = snapped[k - 1] + MIN_SHOT_SECONDS;
    const beat = Math.max(Math.ceil(earliest / period), roundHalfEven(offsets[k] / period));
    snapped.push(round(beat * period));
  }
  // Solve the lengths that put every cut on its beat, as the backend does:
  // overlaps depend on the lengths (the 45 % clamp), so iterate from none.
  const count = durations.length;
  const overlapsOf = (lengths: number[]) =>
    draft.shots.map((shot, index) =>
      index === 0 || shot.transition === 'cut'
        ? 0
        : clampTransition(shot.transitionSeconds, lengths[index - 1], lengths[index]),
    );
  let next = Array.from({ length: count }, () => 0);
  for (let round_ = 0; round_ < 4 * count + 8; round_++) {
    const overlap = next.some(Boolean) ? overlapsOf(next) : Array.from({ length: count }, () => 0);
    const solved = durations.map((duration, k) =>
      k === count - 1
        ? duration
        : round(
            clamp(snapped[k + 1] - snapped[k] + overlap[k + 1], MIN_SHOT_SECONDS, MAX_SHOT_SECONDS),
          ),
    );
    if (solved.every((value, k) => value === next[k])) break;
    next = solved;
  }
  if (next.every((duration, k) => duration === durations[k])) return draft;
  return { ...draft, shots: draft.shots.map((shot, k) => ({ ...shot, duration: next[k] })) };
}

/** Beat times in the finished video: multiples of `period` from 0. */
export function beatTimes(period: number, length: number): number[] {
  if (!(period > 0)) return [];
  const count = Math.min(4000, Math.floor(length / period));
  return Array.from({ length: count + 1 }, (_, index) => round(index * period));
}

/** The nearest candidate within `tolerance`, or `time` itself. */
export function snap(time: number, candidates: number[], tolerance: number): number {
  let best = time;
  let distance = tolerance;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - time);
    if (gap <= distance) {
      best = candidate;
      distance = gap;
    }
  }
  return best;
}

/** Bounded undo/redo history of drafts. */
export interface History {
  past: PromoDraft[];
  future: PromoDraft[];
}

export const HISTORY_LIMIT = 100;

export function record(history: History, previous: PromoDraft): History {
  return { past: [...history.past, previous].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(
  history: History,
  current: PromoDraft,
): { history: History; draft: PromoDraft } | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
    draft: previous,
  };
}

export function redo(
  history: History,
  current: PromoDraft,
): { history: History; draft: PromoDraft } | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    history: { past: [...history.past, current], future: history.future.slice(1) },
    draft: next,
  };
}
