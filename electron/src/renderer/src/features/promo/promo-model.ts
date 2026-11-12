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
export type PromoCorner =
  | 'none'
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

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
  'top_center',
  'top_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
];

/** Mirrors services/promo_video.py. */
export const MIN_SHOT_SECONDS = 0.5;
export const MAX_SHOT_SECONDS = 60;
export const MAX_SHOTS = 40;
export const MAX_PROGRAM_SECONDS = 300;
export const MAX_TRANSITION_SECONDS = 2;
export const MAX_OUTRO_SECONDS = 10;
export const MAX_OVERLAYS = 12;
const TRANSITION_SHARE = 0.45;
const OUTRO_FADE_SECONDS = 0.6;
/** Every animated template fades out over its last half second (promo-templates.ts). */
const OVERLAY_FADE_SECONDS = 0.5;

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

/** A transparent animated layer (rendered on the desktop) laid over the shots. */
export interface PromoOverlay {
  key: string;
  media: PromoMedia;
  /**
   * The shot it is anchored to, by key. The backend resolves the anchor after
   * beat snapping, so the overlay stays on its shot when the cuts move.
   * Missing (or the shot was removed): `start` counts from the video start.
   */
  shotKey?: string | null;
  /** Seconds into its shot, or into the finished video when unanchored. */
  start: number;
  /** The title it shows, so the list stays readable. */
  label: string;
}

/** Output size per format; mirrors SHAPES in services/promo_video.py. */
export const SHAPE_SIZE: Record<PromoShape, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

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
  overlays: PromoOverlay[];
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
  overlays: [],
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

/**
 * When each shot (and the logo ending, last) starts to show, and the length of
 * the finished video. Mirrors segment_starts in services/promo_video.py.
 */
export function timeline(draft: PromoDraft): { starts: number[]; length: number } {
  const segments: { duration: number; transition: PromoTransition; seconds: number }[] =
    draft.shots.map((shot) => ({
      duration: shot.duration,
      transition: shot.transition,
      seconds: shot.transitionSeconds,
    }));
  const outro = draft.logo ? clamp(draft.outroSeconds, 0, MAX_OUTRO_SECONDS) : 0;
  if (outro > 0 && segments.length)
    segments.push({ duration: outro, transition: 'fade', seconds: OUTRO_FADE_SECONDS });
  const starts: number[] = [];
  let total = 0;
  segments.forEach((segment, index) => {
    if (index === 0) {
      starts.push(0);
      total = segment.duration;
      return;
    }
    const overlap =
      segment.transition === 'cut'
        ? 0
        : clampTransition(segment.seconds, segments[index - 1].duration, segment.duration);
    starts.push(Math.round((total - overlap) * 1000) / 1000);
    total += segment.duration - overlap;
  });
  return { starts, length: Math.round(total * 1000) / 1000 };
}

/** Seconds of finished video, logo ending included. */
export function programLength(draft: PromoDraft): number {
  return timeline(draft).length;
}

/** Index of the shot an overlay is anchored to, or -1. */
export function anchorIndex(draft: PromoDraft, overlay: PromoOverlay): number {
  return overlay.shotKey ? draft.shots.findIndex((shot) => shot.key === overlay.shotKey) : -1;
}

/**
 * Something the user should know about an overlay before rendering: its shot
 * was removed (it now counts from the video start), or it starts after the
 * video ends (it will not show). Beat snapping can still move anchored ones.
 */
export function overlayProblem(
  draft: PromoDraft,
  overlay: PromoOverlay,
): 'shot_removed' | 'after_end' | 'overlaps' | null {
  const index = anchorIndex(draft, overlay);
  if (overlay.shotKey && index < 0) return 'shot_removed';
  const { starts, length } = timeline(draft);
  const at = (item: PromoOverlay) => {
    const shot = anchorIndex(draft, item);
    return shot >= 0 ? starts[shot] + item.start : item.start;
  };
  const start = at(overlay);
  if (draft.shots.length && start >= length) return 'after_end';
  // Two layers on screen at once usually means one covers the other. Every
  // template fades out over its last OVERLAY_FADE_SECONDS, so a shorter
  // overlap is a hand-over, not a clash. The planned times are a guide,
  // since beat snapping can still move the cuts.
  const end = start + (overlay.media.duration ?? 0);
  const clash = draft.overlays.some((other) => {
    if (other.key === overlay.key) return false;
    const from = at(other);
    const shared = Math.min(end, from + (other.media.duration ?? 0)) - Math.max(start, from);
    return shared > OVERLAY_FADE_SECONDS;
  });
  return clash ? 'overlaps' : null;
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
    overlays: draft.overlays.slice(0, MAX_OVERLAYS).map((overlay) => {
      const shot = anchorIndex(draft, overlay);
      return {
        media_id: overlay.media.id,
        start: clamp(overlay.start, 0, MAX_PROGRAM_SECONDS),
        ...(shot >= 0 ? { shot } : {}),
      };
    }),
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
      overlays: Array.isArray(saved.overlays)
        ? saved.overlays.filter(isOverlay).slice(0, MAX_OVERLAYS)
        : [],
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

function isOverlay(value: unknown): value is PromoOverlay {
  if (!value || typeof value !== 'object') return false;
  const overlay = value as Partial<PromoOverlay>;
  return (
    typeof overlay.key === 'string' &&
    typeof overlay.label === 'string' &&
    typeof overlay.start === 'number' &&
    Number.isFinite(overlay.start) &&
    (overlay.shotKey === undefined ||
      overlay.shotKey === null ||
      typeof overlay.shotKey === 'string') &&
    !!overlay.media &&
    typeof overlay.media.id === 'string'
  );
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
