/**
 * Transitions between clips on the main track. A transition belongs to the
 * clip it leaves (`transition.type`, `transition.duration` in its params) and
 * overlaps that clip's end with the start of the next one, so the main track
 * gets shorter by the overlap, as in CapCut. The same functions drive the
 * preview, the export and the sound, so all three agree.
 */
import type { TimelineElement, VideoTrack } from '@/lib/opencut/vendor/timeline/types';
import type { EditorRenderExtras } from '@/lib/opencut/vendor/services/renderer/scene-builder';
import type { FrameAdjust, FrameAdjustFn } from '@/lib/opencut/frame-adjust';
import { secondsOf, ticks } from './project';

export const TRANSITIONS = ['none', 'fade', 'black', 'slide', 'push', 'zoom', 'wipe'] as const;
export type TransitionType = (typeof TRANSITIONS)[number];
export const DEFAULT_TRANSITION_SECONDS = 0.5;
export const MIN_TRANSITION_SECONDS = 0.1;
export const MAX_TRANSITION_SECONDS = 2;
export const TRANSITION_KEYS = ['transition.type', 'transition.duration'] as const;

export interface Transition {
  type: Exclude<TransitionType, 'none'>;
  seconds: number;
}

/** The transition a clip asks for into the next one, before it is fitted to the clips. */
export function transitionOf(element: TimelineElement): Transition | null {
  const type = element.params['transition.type'];
  if (typeof type !== 'string' || type === 'none' || !TRANSITIONS.includes(type as TransitionType)) return null;
  const raw = element.params['transition.duration'];
  const seconds = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_TRANSITION_SECONDS;
  return {
    type: type as Transition['type'],
    seconds: Math.min(MAX_TRANSITION_SECONDS, Math.max(MIN_TRANSITION_SECONDS, seconds)),
  };
}

/**
 * Ticks the clip `from` overlaps the next clip `to`: the transition's length,
 * at most half of the shorter clip, so a clip is never in two transitions at once.
 */
export function overlapTicks(from: TimelineElement, to: TimelineElement | undefined): number {
  const transition = to ? transitionOf(from) : null;
  if (!transition || !to) return 0;
  const wanted = ticks(transition.seconds);
  return Math.max(0, Math.min(wanted, Math.floor(from.duration / 2), Math.floor(to.duration / 2)));
}

/** A transition as it plays: where it starts on the timeline and how long it lasts, in seconds. */
export interface PlacedTransition {
  type: Transition['type'];
  start: number;
  seconds: number;
  fromId: string;
  toId: string;
}

/** Every transition on the main track, in order (the track must be packed). */
export function placedTransitions(main: readonly TimelineElement[]): PlacedTransition[] {
  const ordered = [...main].sort((a, b) => a.startTime - b.startTime);
  const placed: PlacedTransition[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const overlap = overlapTicks(ordered[i], ordered[i + 1]);
    if (!overlap) continue;
    placed.push({
      type: transitionOf(ordered[i])!.type,
      start: secondsOf(ordered[i + 1].startTime),
      seconds: secondsOf(overlap),
      fromId: ordered[i].id,
      toId: ordered[i + 1].id,
    });
  }
  return placed;
}

/** Eases a transition's progress in and out. */
const ease = (p: number) => p * p * (3 - 2 * p);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/** How the clip coming in looks `p` (0..1) through the transition. */
export function incoming(type: Transition['type'], p: number, width: number): FrameAdjust | null {
  const e = ease(clamp01(p));
  switch (type) {
    case 'fade':
      return { opacity: e };
    case 'black':
      // Hidden while the clip going out darkens; the shade then lifts off it.
      return { opacity: p < 0.5 ? 0 : 1 };
    case 'slide':
    case 'push':
      return { offsetX: (1 - e) * width };
    case 'zoom':
      return { opacity: e, scale: 1.2 - 0.2 * e };
    case 'wipe':
      return { clip: { from: 0, to: e } };
  }
}

/** How the clip going out looks `p` (0..1) through the transition. */
export function outgoing(type: Transition['type'], p: number, width: number): FrameAdjust | null {
  const e = ease(clamp01(p));
  switch (type) {
    case 'black':
      return { opacity: p < 0.5 ? 1 : 0 };
    case 'push':
      return { offsetX: -e * width };
    case 'zoom':
      return { scale: 1 + 0.3 * e };
    default:
      // Fade, slide and wipe draw the clip coming in over it.
      return null;
  }
}

/** How dark the black shade is `p` through a fade through black: up to full at the middle and back. */
export const shadeOpacity = (p: number): number => 1 - Math.abs(2 * clamp01(p) - 1);

/**
 * Per-frame adjustments for every main-track clip in a transition, keyed by
 * clip id, for a canvas `width` pixels wide.
 */
export function transitionAdjusters(main: readonly TimelineElement[], width: number): Map<string, FrameAdjustFn> {
  const placed = placedTransitions(main);
  const into = new Map(placed.map((item) => [item.toId, item]));
  const out = new Map(placed.map((item) => [item.fromId, item]));
  const adjusters = new Map<string, FrameAdjustFn>();
  for (const element of main) {
    const before = into.get(element.id);
    const after = out.get(element.id);
    if (!before && !after) continue;
    const duration = secondsOf(element.duration);
    adjusters.set(element.id, (seconds) => {
      if (before && seconds < before.seconds) return incoming(before.type, seconds / before.seconds, width);
      if (after && seconds > duration - after.seconds)
        return outgoing(after.type, (seconds - (duration - after.seconds)) / after.seconds, width);
      return null;
    });
  }
  return adjusters;
}

/**
 * Equal-power crossfade gain for a clip's sound `local` seconds in, given how
 * long it overlaps the clip before (`crossIn`) and after (`crossOut`).
 */
export function crossfadeGain(local: number, duration: number, crossIn: number, crossOut: number): number {
  let gain = 1;
  if (crossIn > 0 && local < crossIn) gain *= Math.sin((clamp01(local / crossIn) * Math.PI) / 2);
  if (crossOut > 0 && duration - local < crossOut) gain *= Math.sin((clamp01((duration - local) / crossOut) * Math.PI) / 2);
  return gain;
}

/**
 * Main-track clips with what a render needs on top of the saved clip: their
 * transition, and their own decoder when a clip of the same file plays at the
 * same moment (a transition between the halves of a split clip).
 */
export function mainForRender(main: VideoTrack, width: number): VideoTrack {
  const adjusters = transitionAdjusters(main.elements, width);
  const ordered = [...main.elements].sort((a, b) => a.startTime - b.startTime);
  const lanes = new Map<string, number>();
  ordered.forEach((element, index) => {
    const before = ordered[index - 1];
    const shared =
      before && 'mediaId' in before && 'mediaId' in element && before.mediaId === element.mediaId &&
      before.startTime + before.duration > element.startTime;
    lanes.set(element.id, shared ? 1 - (lanes.get(before.id) ?? 0) : 0);
  });
  const elements = main.elements.map((element): TimelineElement => {
    const extras: EditorRenderExtras = { frameAdjust: adjusters.get(element.id) };
    if ('mediaId' in element) extras.cacheKey = `${element.mediaId}#main#${lanes.get(element.id) ?? 0}`;
    return { ...element, ...extras } as TimelineElement;
  });
  return { ...main, elements: elements as VideoTrack['elements'] };
}
