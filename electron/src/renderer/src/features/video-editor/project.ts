/**
 * The video editor's project: OpenCut's multi-track timeline (`SceneTracks`)
 * plus the uploaded files it points at. Times are OpenCut media ticks
 * (`MediaTime`); the UI converts to seconds at the edges.
 */
import type { SceneTracks, TimelineElement, TimelineTrack } from '@/lib/opencut/vendor/timeline/types';
import {
  TICKS_PER_SECOND,
  mediaTime,
  mediaTimeToSeconds,
  type MediaTime,
} from '@/lib/opencut/vendor/wasm';

export type EditorShape = 'vertical' | 'square' | 'landscape';
export const EDITOR_SHAPES: readonly EditorShape[] = ['vertical', 'square', 'landscape'];
export const EDITOR_FPS = [30, 60] as const;
export type EditorFps = (typeof EDITOR_FPS)[number];

export const SHAPE_SIZE: Record<EditorShape, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

/** Longest video the editor exports; the encoder keeps the whole file in memory. */
export const MAX_EXPORT_SECONDS = 300;
export const MIN_CLIP_SECONDS = 0.1;
export const MAX_SPEED = 4;
export const MIN_SPEED = 0.25;

/** A file uploaded to the engine (`POST /promo/media`). */
export interface EditorMedia {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  url: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  has_audio?: boolean;
}

export interface EditorProject {
  version: 1;
  name: string;
  shape: EditorShape;
  fps: EditorFps;
  background: string;
  tracks: SceneTracks;
  media: EditorMedia[];
}

export interface ElementRef {
  trackId: string;
  elementId: string;
}

export const PROJECT_KEY = 'voicestudio.editor.v1';
export const MAIN_TRACK_ID = 'main';

export const ticks = (seconds: number): MediaTime =>
  mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
export const secondsOf = (time: number): number => mediaTimeToSeconds({ time: time as MediaTime });

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function emptyProject(): EditorProject {
  return {
    version: 1,
    name: '',
    shape: 'vertical',
    fps: 30,
    background: '#000000',
    tracks: {
      main: { id: MAIN_TRACK_ID, name: 'Main', type: 'video', elements: [], muted: false, hidden: false },
      overlay: [],
      audio: [],
    },
    media: [],
  };
}

/** Every track, top of the stack first: overlays, the main track, then audio. */
export function allTracks(project: EditorProject): TimelineTrack[] {
  return [...project.tracks.overlay, project.tracks.main, ...project.tracks.audio];
}

export function findTrack(project: EditorProject, trackId: string): TimelineTrack | undefined {
  return allTracks(project).find((track) => track.id === trackId);
}

export function findElement(
  project: EditorProject,
  ref: ElementRef | null,
): { track: TimelineTrack; element: TimelineElement } | null {
  if (!ref) return null;
  const track = findTrack(project, ref.trackId);
  const element = track?.elements.find((item) => item.id === ref.elementId);
  return track && element ? { track, element } : null;
}

export function findMedia(project: EditorProject, mediaId: string): EditorMedia | undefined {
  return project.media.find((media) => media.id === mediaId);
}

/** Seconds from the start to the end of the last element on any track. */
export function projectSeconds(project: EditorProject): number {
  let end = 0;
  for (const track of allTracks(project))
    for (const element of track.elements) end = Math.max(end, element.startTime + element.duration);
  return secondsOf(end);
}

/** A saved project, or null when `raw` is missing or not a project this version reads. */
export function parseProject(raw: string | null | undefined): EditorProject | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<EditorProject>;
    const base = emptyProject();
    if (saved.version !== 1 || !saved.tracks?.main) return null;
    return {
      ...base,
      ...saved,
      shape: EDITOR_SHAPES.includes(saved.shape as EditorShape) ? (saved.shape as EditorShape) : base.shape,
      fps: saved.fps === 60 ? 60 : 30,
      media: Array.isArray(saved.media) ? saved.media : [],
      tracks: {
        main: { ...base.tracks.main, ...saved.tracks.main, id: MAIN_TRACK_ID },
        overlay: Array.isArray(saved.tracks.overlay) ? saved.tracks.overlay : [],
        audio: Array.isArray(saved.tracks.audio) ? saved.tracks.audio : [],
      },
    };
  } catch {
    return null;
  }
}

/** The project as stored: decoded audio buffers never belong in storage. */
export const serializeProject = (project: EditorProject): string =>
  JSON.stringify(project, (key, value) => (key === 'buffer' ? undefined : value));

/** The single project of the first editor release (before the project library). */
export function loadProject(storage: Pick<Storage, 'getItem'> | null = safeStorage()): EditorProject {
  try {
    return parseProject(storage?.getItem(PROJECT_KEY)) ?? emptyProject();
  } catch {
    return emptyProject();
  }
}

export function saveProject(
  project: EditorProject,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(PROJECT_KEY, serializeProject(project));
  } catch {
    // Storage full or blocked: the project stays in memory for this session.
  }
}

export function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
