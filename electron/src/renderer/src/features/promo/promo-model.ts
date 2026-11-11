/**
 * Promo video draft: the shots, look, music and logo the user picked, the
 * request body for `POST /promo/render`, and the program length computed with
 * the same rule as `backend/services/promo_video.py` (a transition of `d`
 * seconds overlaps the two shots it joins, and never takes more than 45 % of
 * either).
 */

export type PromoShape = 'vertical' | 'square' | 'landscape';
export type PromoFit = 'cover' | 'contain';
export type PromoMotion = 'none' | 'zoom_in' | 'zoom_out';
export type PromoCorner = 'none' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

export const SHAPES: readonly PromoShape[] = ['vertical', 'square', 'landscape'];
export const FPS_CHOICES = [30, 60] as const;
export const TRANSITIONS = [
  'cut',
  'fade',
  'flash',
  'dip',
  'slide',
  'push',
  'wipe',
  'zoom',
  'circle',
  'blur',
] as const;
export type PromoTransition = (typeof TRANSITIONS)[number];
export const LOOKS = ['none', 'warm', 'cool', 'vivid', 'mono'] as const;
export type PromoLook = (typeof LOOKS)[number];
export const CORNERS: readonly PromoCorner[] = [
  'none',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
];

/** Mirrors services/promo_video.py. */
export const MIN_SHOT_SECONDS = 0.5;
export const MAX_SHOT_SECONDS = 60;
export const MAX_SHOTS = 40;
export const MAX_PROGRAM_SECONDS = 300;
export const MAX_TRANSITION_SECONDS = 2;
export const MAX_OUTRO_SECONDS = 10;
const TRANSITION_SHARE = 0.45;
const OUTRO_FADE_SECONDS = 0.6;

export interface PromoMedia {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  url: string;
}

export interface PromoShot {
  key: string;
  media: PromoMedia;
  duration: number;
  start: number;
  fit: PromoFit;
  motion: PromoMotion;
  transition: PromoTransition;
  transitionSeconds: number;
}

export interface PromoDraft {
  shots: PromoShot[];
  shape: PromoShape;
  fps: (typeof FPS_CHOICES)[number];
  look: PromoLook;
  music: PromoMedia | null;
  musicVolume: number;
  snapToBeats: boolean;
  narration: PromoMedia | null;
  logo: PromoMedia | null;
  watermark: PromoCorner;
  outroSeconds: number;
  outroColor: string;
}

export const DRAFT_KEY = 'voicestudio.promo.v1';

export const emptyDraft = (): PromoDraft => ({
  shots: [],
  shape: 'vertical',
  fps: 30,
  look: 'none',
  music: null,
  musicVolume: 0.8,
  snapToBeats: false,
  narration: null,
  logo: null,
  watermark: 'none',
  outroSeconds: 2,
  outroColor: '#0b0b0b',
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** A new shot for an uploaded clip or still, with sensible defaults. */
export function shotFor(media: PromoMedia, key: string): PromoShot {
  const length = media.kind === 'video' && media.duration ? Math.min(3, media.duration) : 2.5;
  return {
    key,
    media,
    duration: clamp(Math.round(length * 10) / 10, MIN_SHOT_SECONDS, MAX_SHOT_SECONDS),
    start: 0,
    fit: 'cover',
    motion: media.kind === 'image' ? 'zoom_in' : 'none',
    transition: 'fade',
    transitionSeconds: 0.5,
  };
}

export function clampTransition(seconds: number, before: number, after: number): number {
  const limit = Math.min(MAX_TRANSITION_SECONDS, TRANSITION_SHARE * Math.min(before, after));
  return Math.max(0, Math.min(seconds, limit));
}

/** Seconds of finished video, logo ending included. */
export function programLength(draft: PromoDraft): number {
  const segments: { duration: number; transition: PromoTransition; seconds: number }[] =
    draft.shots.map((shot) => ({
      duration: shot.duration,
      transition: shot.transition,
      seconds: shot.transitionSeconds,
    }));
  const outro = draft.logo ? clamp(draft.outroSeconds, 0, MAX_OUTRO_SECONDS) : 0;
  if (outro > 0 && segments.length)
    segments.push({ duration: outro, transition: 'fade', seconds: OUTRO_FADE_SECONDS });
  let total = 0;
  segments.forEach((segment, index) => {
    if (index === 0) {
      total = segment.duration;
      return;
    }
    const overlap =
      segment.transition === 'cut'
        ? 0
        : clampTransition(segment.seconds, segments[index - 1].duration, segment.duration);
    total += segment.duration - overlap;
  });
  return Math.round(total * 1000) / 1000;
}

export function draftProblem(draft: PromoDraft): 'empty' | 'too_long' | 'too_many' | null {
  if (!draft.shots.length) return 'empty';
  if (draft.shots.length > MAX_SHOTS) return 'too_many';
  if (programLength(draft) > MAX_PROGRAM_SECONDS) return 'too_long';
  return null;
}

/** Body for `POST /promo/render`. */
export function renderRequest(draft: PromoDraft) {
  return {
    shape: draft.shape,
    fps: draft.fps,
    look: draft.look,
    shots: draft.shots.map((shot) => ({
      media_id: shot.media.id,
      duration: clamp(shot.duration, MIN_SHOT_SECONDS, MAX_SHOT_SECONDS),
      start: shot.media.kind === 'video' ? Math.max(0, shot.start) : 0,
      fit: shot.fit,
      motion: shot.media.kind === 'image' ? shot.motion : 'none',
      transition: shot.transition,
      transition_seconds: clamp(shot.transitionSeconds, 0, MAX_TRANSITION_SECONDS),
    })),
    logo_id: draft.logo?.id ?? null,
    watermark: draft.logo ? draft.watermark : 'none',
    outro_seconds: draft.logo ? clamp(draft.outroSeconds, 0, MAX_OUTRO_SECONDS) : 0,
    outro_color: draft.outroColor,
    music_id: draft.music?.id ?? null,
    music_volume: clamp(draft.musicVolume, 0, 2),
    narration_id: draft.narration?.id ?? null,
    snap_to_beats: !!draft.music && draft.snapToBeats,
  };
}

export function moveShot(shots: PromoShot[], index: number, step: -1 | 1): PromoShot[] {
  const target = index + step;
  if (target < 0 || target >= shots.length) return shots;
  const next = shots.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The saved draft, or an empty one when storage is missing or unreadable. */
export function loadDraft(storage: Pick<Storage, 'getItem'> | null = safeStorage()): PromoDraft {
  try {
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const saved = JSON.parse(raw) as Partial<PromoDraft>;
    const base = emptyDraft();
    return {
      ...base,
      ...saved,
      shots: Array.isArray(saved.shots) ? saved.shots.slice(0, MAX_SHOTS) : [],
      shape: SHAPES.includes(saved.shape as PromoShape) ? (saved.shape as PromoShape) : base.shape,
      fps: saved.fps === 60 ? 60 : 30,
      look: LOOKS.includes(saved.look as PromoLook) ? (saved.look as PromoLook) : base.look,
      watermark: CORNERS.includes(saved.watermark as PromoCorner)
        ? (saved.watermark as PromoCorner)
        : base.watermark,
    };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(
  draft: PromoDraft,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
) {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft simply is not remembered.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
