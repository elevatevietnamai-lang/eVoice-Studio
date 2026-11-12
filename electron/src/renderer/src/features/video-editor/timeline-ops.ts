/**
 * Pure project edits for the video editor: each takes a project and returns a
 * new one, so undo/redo is a stack of snapshots.
 *
 * The main track is magnetic, as in CapCut: its clips always sit end to end
 * from 0:00, so trimming, splitting, deleting or reordering ripples the rest.
 * Overlay and audio tracks place clips freely; a move that would overlap
 * another clip lands on a new track instead.
 */
import type {
  AudioTrack,
  ImageElement,
  SceneTracks,
  TextElement,
  TextTrack,
  TimelineElement,
  TimelineTrack,
  UploadAudioElement,
  VideoElement,
  VideoTrack,
} from '@/lib/opencut/vendor/timeline/types';
import {
  buildDefaultParamValues,
  getBuiltInElementParams,
  getElementParam,
} from '@/lib/opencut/vendor/params/registry';
import { coerceParamValue, getParamChannelLayout, type ParamValue } from '@/lib/opencut/vendor/params';
import {
  getElementKeyframes,
  getKeyframeAtTime,
} from '@/lib/opencut/vendor/animation/keyframe-query';
import {
  removeElementKeyframe,
  retimeElementKeyframe,
  splitAnimationsAtTime,
  upsertPathKeyframe,
} from '@/lib/opencut/vendor/animation/keyframes';
import type { AnimationPath, ElementAnimations } from '@/lib/opencut/vendor/animation/types';
import { mediaTime, ZERO_MEDIA_TIME, type MediaTime } from '@/lib/opencut/vendor/wasm';
import {
  MAIN_TRACK_ID,
  MAX_SPEED,
  MIN_CLIP_SECONDS,
  MIN_SPEED,
  findElement,
  newId,
  ticks,
  type EditorMedia,
  type EditorProject,
  type ElementRef,
} from './project';
import { TRANSITION_KEYS, overlapTicks } from './transitions';
import { MASK_PARAMS, maskKeyOf, maskValue, withMaskParam, withMaskShape, type MaskShape } from './masks';

export const DEFAULT_STILL_SECONDS = 3;
export const DEFAULT_TEXT_SECONDS = 3;
/** Text fonts the renderer has without a download (fontsource in main.tsx). */
export const TEXT_FONTS = ['Inter Variable', 'Space Grotesk Variable'] as const;

type Placement = 'main' | 'overlay';
const at = (value: number): MediaTime => mediaTime({ ticks: Math.max(0, Math.round(value)) });
const MIN_TICKS = () => ticks(MIN_CLIP_SECONDS);

export function rateOf(element: TimelineElement): number {
  return 'retime' in element && element.retime ? element.retime.rate : 1;
}

/** Ticks of source media the clip may still reveal, or null for stills and text. */
function sourceTicks(element: TimelineElement): number | null {
  return element.sourceDuration != null ? element.sourceDuration : null;
}

function compatible(element: TimelineElement, track: TimelineTrack): boolean {
  if (element.type === 'video' || element.type === 'image') return track.type === 'video';
  if (element.type === 'text') return track.type === 'text';
  if (element.type === 'audio') return track.type === 'audio';
  return false;
}

function isFree(track: TimelineTrack, start: number, end: number, exceptId?: string): boolean {
  return track.elements.every(
    (other) => other.id === exceptId || other.startTime >= end || other.startTime + other.duration <= start,
  );
}

function withTracks(project: EditorProject, tracks: SceneTracks): EditorProject {
  return { ...project, tracks };
}

function mapTrack(project: EditorProject, trackId: string, map: (track: TimelineTrack) => TimelineTrack) {
  const { main, overlay, audio } = project.tracks;
  return withTracks(project, {
    main: main.id === trackId ? (map(main) as VideoTrack) : main,
    overlay: overlay.map((track) => (track.id === trackId ? (map(track) as typeof track) : track)),
    audio: audio.map((track) => (track.id === trackId ? (map(track) as AudioTrack) : track)),
  });
}

/**
 * Clips on the main track end to end from 0:00, in their current order; a
 * transition overlaps a clip's end with the next clip's start.
 */
function packMain(project: EditorProject): EditorProject {
  let cursor = 0;
  const sorted = [...project.tracks.main.elements].sort((a, b) => a.startTime - b.startTime);
  const elements = sorted.map((element, index) => {
    const placed = { ...element, startTime: at(cursor) };
    cursor += element.duration - overlapTicks(element, sorted[index + 1]);
    return placed;
  });
  return withTracks(project, { ...project.tracks, main: { ...project.tracks.main, elements } });
}

/** Drops empty overlay and audio tracks; the main track always stays. */
function pruneTracks(project: EditorProject): EditorProject {
  return withTracks(project, {
    ...project.tracks,
    overlay: project.tracks.overlay.filter((track) => track.elements.length),
    audio: project.tracks.audio.filter((track) => track.elements.length),
  });
}

function emptyTrackLike(kind: 'video' | 'text' | 'audio'): TimelineTrack {
  const id = newId();
  if (kind === 'audio') return { id, name: 'Audio', type: 'audio', elements: [], muted: false };
  if (kind === 'text') return { id, name: 'Text', type: 'text', elements: [], hidden: false };
  return { id, name: 'Overlay', type: 'video', elements: [], muted: false, hidden: false };
}

/** Adds a new track: overlays go above `nearTrackId` (or on top), audio below it (or at the bottom). */
function insertTrack(project: EditorProject, track: TimelineTrack, nearTrackId?: string): EditorProject {
  const { overlay, audio } = project.tracks;
  if (track.type === 'audio') {
    const index = audio.findIndex((item) => item.id === nearTrackId);
    const next = [...audio];
    next.splice(index >= 0 ? index + 1 : audio.length, 0, track as AudioTrack);
    return withTracks(project, { ...project.tracks, audio: next });
  }
  const index = overlay.findIndex((item) => item.id === nearTrackId);
  const next = [...overlay];
  next.splice(index >= 0 ? index : 0, 0, track as SceneTracks['overlay'][number]);
  return withTracks(project, { ...project.tracks, overlay: next });
}

function removeFrom(project: EditorProject, ref: ElementRef): EditorProject {
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.filter((element) => element.id !== ref.elementId),
  }) as TimelineTrack);
}

function putOnTrack(project: EditorProject, trackId: string, element: TimelineElement): EditorProject {
  return mapTrack(project, trackId, (track) => ({
    ...track,
    elements: [...track.elements, element].sort((a, b) => a.startTime - b.startTime),
  }) as TimelineTrack);
}

/** Index in the main track where a clip dropped at `time` belongs. */
function mainIndexAt(project: EditorProject, time: number, exceptId?: string): number {
  return project.tracks.main.elements
    .filter((element) => element.id !== exceptId)
    .filter((element) => element.startTime + element.duration / 2 < time).length;
}

function placeOnMain(project: EditorProject, element: TimelineElement, time: number): EditorProject {
  const others = [...project.tracks.main.elements]
    .filter((item) => item.id !== element.id)
    .sort((a, b) => a.startTime - b.startTime);
  const index = mainIndexAt(project, time, element.id);
  // Give the clip a start between its neighbours so packing keeps this order.
  const ordered = [...others.slice(0, index), element, ...others.slice(index)].map((item, order) => ({
    ...item,
    startTime: at(order),
  }));
  return packMain(
    withTracks(project, {
      ...project.tracks,
      main: { ...project.tracks.main, elements: ordered as VideoTrack['elements'] },
    }),
  );
}

/**
 * Places a clip at `start` on `trackId`, or on a new track next to it when
 * that spot is taken.
 */
function placeFree(project: EditorProject, trackId: string | null, element: TimelineElement): {
  project: EditorProject;
  ref: ElementRef;
} {
  const kind = element.type === 'audio' ? 'audio' : element.type === 'text' ? 'text' : 'video';
  const end = element.startTime + element.duration;
  const tracks = kind === 'audio' ? project.tracks.audio : project.tracks.overlay;
  const requested = tracks.find((track) => track.id === trackId);
  const target =
    requested && compatible(element, requested) && isFree(requested, element.startTime, end, element.id)
      ? requested
      : trackId === null
        ? tracks.find((track) => compatible(element, track) && isFree(track, element.startTime, end))
        : undefined;
  if (target) return { project: putOnTrack(project, target.id, element), ref: { trackId: target.id, elementId: element.id } };
  const track = emptyTrackLike(kind);
  const withTrack = insertTrack(project, track, requested?.id);
  return { project: putOnTrack(withTrack, track.id, element), ref: { trackId: track.id, elementId: element.id } };
}

export function addMedia(project: EditorProject, media: EditorMedia): EditorProject {
  if (project.media.some((item) => item.id === media.id)) return project;
  return { ...project, media: [...project.media, media] };
}

/** A new timeline clip for an uploaded file, starting at `start`. */
export function clipFor(media: EditorMedia, start: MediaTime): VideoElement | ImageElement | UploadAudioElement {
  const base = {
    id: newId(),
    name: media.name,
    mediaId: media.id,
    startTime: start,
    trimStart: ZERO_MEDIA_TIME,
    trimEnd: ZERO_MEDIA_TIME,
  };
  if (media.kind === 'image')
    return {
      ...base,
      type: 'image',
      duration: ticks(DEFAULT_STILL_SECONDS),
      params: buildDefaultParamValues(getBuiltInElementParams({ type: 'image' })),
    };
  const length = ticks(Math.max(MIN_CLIP_SECONDS, media.duration ?? DEFAULT_STILL_SECONDS));
  if (media.kind === 'audio')
    return {
      ...base,
      type: 'audio',
      sourceType: 'upload',
      duration: length,
      sourceDuration: length,
      params: { ...buildDefaultParamValues(getBuiltInElementParams({ type: 'audio' })), fadeIn: 0, fadeOut: 0 },
    };
  return {
    ...base,
    type: 'video',
    duration: length,
    sourceDuration: length,
    isSourceAudioEnabled: media.has_audio !== false,
    params: { ...buildDefaultParamValues(getBuiltInElementParams({ type: 'video' })), fadeIn: 0, fadeOut: 0 },
  };
}

/**
 * Adds an uploaded file to the timeline at `seconds`: clips and stills join
 * the main track (or an overlay track), audio goes to a free audio track.
 */
export function insertMedia(
  project: EditorProject,
  media: EditorMedia,
  seconds: number,
  placement: Placement = 'main',
): { project: EditorProject; ref: ElementRef } {
  const withMedia = addMedia(project, media);
  const clip = clipFor(media, ticks(Math.max(0, seconds)));
  if (clip.type === 'audio') return placeFree(withMedia, null, clip);
  if (placement === 'overlay') {
    const track = emptyTrackLike('video');
    const next = insertTrack(withMedia, track);
    return { project: putOnTrack(next, track.id, clip), ref: { trackId: track.id, elementId: clip.id } };
  }
  return {
    project: placeOnMain(withMedia, clip, clip.startTime),
    ref: { trackId: MAIN_TRACK_ID, elementId: clip.id },
  };
}

export function addText(
  project: EditorProject,
  seconds: number,
  content: string,
  font: string = TEXT_FONTS[0],
): { project: EditorProject; ref: ElementRef } {
  const text: TextElement = {
    id: newId(),
    name: content,
    type: 'text',
    startTime: ticks(Math.max(0, seconds)),
    duration: ticks(DEFAULT_TEXT_SECONDS),
    trimStart: ZERO_MEDIA_TIME,
    trimEnd: ZERO_MEDIA_TIME,
    params: {
      ...buildDefaultParamValues(getBuiltInElementParams({ type: 'text' })),
      content,
      fontFamily: font,
      fontSize: 7,
      color: '#ffffff',
      fontWeight: 'bold',
    },
  };
  return placeFree(project, null, text);
}

export interface CaptionSegment {
  start: number | null;
  end: number | null;
  text: string;
}

/** Most words on one caption line when the timing has to be estimated. */
const WORDS_PER_CAPTION = 7;

/**
 * Captions for a transcript that came back without timings: short lines that
 * break at sentence ends, commas or every few words, spread over the stretch
 * where there is speech in proportion to their length.
 */
export function captionsFromText(text: string, start: number, end: number): CaptionSegment[] {
  const lines: string[] = [];
  for (const sentence of text.split(/(?<=[.!?\u2026\u3002\uff01\uff1f])\s+|(?<=[,;:\uff0c\uff1b])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += WORDS_PER_CAPTION) lines.push(words.slice(i, i + WORDS_PER_CAPTION).join(' '));
  }
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (!total || end <= start) return [];
  let cursor = start;
  return lines.map((line) => {
    const length = ((end - start) * line.length) / total;
    const segment = { start: cursor, end: cursor + length, text: line };
    cursor += length;
    return segment;
  });
}

/** Shortest a caption stays on screen, in seconds. */
const MIN_CAPTION_SECONDS = 0.4;
/** Caption size in OpenCut units (pixels = size × canvas height / 90). */
const CAPTION_FONT_SIZE = 3;
/** Rough width of an average bold character relative to its font size. */
const CHAR_WIDTH_RATIO = 0.55;

/** Breaks a caption into lines that fit 85% of the frame width. */
export function wrapCaption(text: string, canvas: { width: number; height: number }): string {
  const fontPixels = (CAPTION_FONT_SIZE * canvas.height) / 90;
  const perLine = Math.max(8, Math.floor((canvas.width * 0.85) / (fontPixels * CHAR_WIDTH_RATIO)));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Turns transcribed speech into captions on a new text track: one title per
 * segment, low in the frame on a dark box, never overlapping the next.
 */
export function addCaptions(
  project: EditorProject,
  segments: CaptionSegment[],
  canvas: { width: number; height: number },
): EditorProject {
  const usable = segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text && segment.start !== null && segment.end !== null)
    .sort((a, b) => a.start! - b.start!);
  if (!usable.length) return project;
  const track = emptyTrackLike('text') as TextTrack;
  const elements: TextElement[] = usable.map((segment, index) => {
    const start = Math.max(0, segment.start!);
    const next = usable[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const end = Math.min(Math.max(segment.end!, start + MIN_CAPTION_SECONDS), next);
    return {
      id: newId(),
      name: segment.text,
      type: 'text',
      startTime: ticks(start),
      duration: ticks(Math.max(MIN_CLIP_SECONDS, end - start)),
      trimStart: ZERO_MEDIA_TIME,
      trimEnd: ZERO_MEDIA_TIME,
      params: {
        ...buildDefaultParamValues(getBuiltInElementParams({ type: 'text' })),
        content: wrapCaption(segment.text, canvas),
        fontFamily: TEXT_FONTS[0],
        fontSize: CAPTION_FONT_SIZE,
        color: '#ffffff',
        fontWeight: 'bold',
        'background.enabled': true,
        'background.color': '#000000',
        'transform.positionY': Math.round(canvas.height * 0.3),
      },
    };
  });
  return insertTrack(project, { ...track, name: 'Captions', elements });
}

/** Moves a clip to start at `seconds`, on `trackId` when given and compatible. */
export function moveElement(
  project: EditorProject,
  ref: ElementRef,
  seconds: number,
  trackId: string = ref.trackId,
): { project: EditorProject; ref: ElementRef } {
  const found = findElement(project, ref);
  if (!found) return { project, ref };
  const target = [project.tracks.main, ...project.tracks.overlay, ...project.tracks.audio].find(
    (track) => track.id === trackId,
  );
  if (!target || !compatible(found.element, target)) return { project, ref };
  const moved = { ...found.element, startTime: ticks(Math.max(0, seconds)) };
  let next = removeFrom(project, ref);
  if (ref.trackId === MAIN_TRACK_ID) next = packMain(next);
  if (target.id === MAIN_TRACK_ID) {
    next = placeOnMain(next, moved, moved.startTime);
    return { project: pruneTracks(next), ref: { trackId: MAIN_TRACK_ID, elementId: moved.id } };
  }
  const placed = placeFree(next, target.id, moved);
  return { project: pruneTracks(placed.project), ref: placed.ref };
}

/** Shifts keyframes by `delta` ticks and drops the ones outside the clip. */
function shiftAnimations(
  animations: ElementAnimations | undefined,
  delta: number,
  duration: number,
): ElementAnimations | undefined {
  if (!animations || !delta) return animations;
  let next: ElementAnimations | undefined = animations;
  for (const key of getElementKeyframes({ animations })) {
    const time = key.time + delta;
    next =
      time < 0 || time > duration
        ? removeElementKeyframe({ animations: next, propertyPath: key.propertyPath, keyframeId: key.id })
        : retimeElementKeyframe({ animations: next, propertyPath: key.propertyPath, keyframeId: key.id, time: at(time) });
  }
  return next;
}

function neighbours(track: TimelineTrack, element: TimelineElement) {
  const before = track.elements.filter((other) => other.id !== element.id && other.startTime < element.startTime);
  const after = track.elements.filter((other) => other.id !== element.id && other.startTime >= element.startTime);
  return {
    floor: before.reduce((end, other) => Math.max(end, other.startTime + other.duration), 0),
    ceiling: after.reduce((start, other) => Math.min(start, other.startTime), Number.POSITIVE_INFINITY),
  };
}

/**
 * Moves one edge of a clip to `seconds` on the timeline. Clips with a source
 * reveal or hide source media; stills and text simply get longer or shorter.
 */
export function trimElement(
  project: EditorProject,
  ref: ElementRef,
  edge: 'start' | 'end',
  seconds: number,
): EditorProject {
  const found = findElement(project, ref);
  if (!found) return project;
  const { track, element } = found;
  const rate = rateOf(element);
  const source = sourceTicks(element);
  const onMain = track.id === MAIN_TRACK_ID;
  const { floor, ceiling } = onMain ? { floor: 0, ceiling: Number.POSITIVE_INFINITY } : neighbours(track, element);
  const end = element.startTime + element.duration;
  let next: TimelineElement;
  if (edge === 'start') {
    // On the main track the left edge trims the source; the clip stays where it is.
    let delta = ticks(seconds) - element.startTime;
    delta = Math.min(delta, element.duration - MIN_TICKS());
    if (source !== null) delta = Math.max(delta, -element.trimStart / rate);
    if (!onMain) delta = Math.max(delta, floor - element.startTime);
    if (onMain && source === null) delta = Math.max(delta, -element.startTime);
    const duration = element.duration - delta;
    next = {
      ...element,
      startTime: onMain ? element.startTime : at(element.startTime + delta),
      duration: at(duration),
      trimStart: source !== null ? at(element.trimStart + delta * rate) : element.trimStart,
      animations: shiftAnimations(element.animations, -delta, duration),
    } as TimelineElement;
  } else {
    let newEnd = Math.max(ticks(seconds), element.startTime + MIN_TICKS());
    if (source !== null) newEnd = Math.min(newEnd, element.startTime + (source - element.trimStart) / rate);
    if (!onMain) newEnd = Math.min(newEnd, ceiling);
    const duration = newEnd - element.startTime;
    next = {
      ...element,
      duration: at(duration),
      trimEnd: source !== null ? at(Math.max(0, source - element.trimStart - duration * rate)) : element.trimEnd,
      animations: duration < end - element.startTime ? shiftAnimations(element.animations, 0, duration) : element.animations,
    } as TimelineElement;
  }
  const updated = mapTrack(project, track.id, (current) => ({
    ...current,
    elements: current.elements.map((item) => (item.id === element.id ? next : item)),
  }) as TimelineTrack);
  return onMain ? packMain(updated) : updated;
}

/** Splits a clip at `seconds`; returns the right-hand part's ref. */
export function splitElement(
  project: EditorProject,
  ref: ElementRef,
  seconds: number,
): { project: EditorProject; ref: ElementRef } {
  const found = findElement(project, ref);
  if (!found) return { project, ref };
  const { track, element } = found;
  const cut = ticks(seconds) - element.startTime;
  if (cut < MIN_TICKS() || cut > element.duration - MIN_TICKS()) return { project, ref };
  const rate = rateOf(element);
  const source = sourceTicks(element);
  const { leftAnimations, rightAnimations } = splitAnimationsAtTime({
    animations: element.animations,
    splitTime: at(cut),
  });
  // The transition into the next clip stays at the end, with the right-hand part.
  const leftParams = { ...element.params };
  for (const key of TRANSITION_KEYS) delete leftParams[key];
  const left = {
    ...element,
    params: leftParams,
    duration: at(cut),
    trimEnd: source !== null ? at(source - element.trimStart - cut * rate) : element.trimEnd,
    animations: leftAnimations,
  } as TimelineElement;
  const right = {
    ...element,
    id: newId(),
    startTime: at(element.startTime + cut),
    duration: at(element.duration - cut),
    trimStart: source !== null ? at(element.trimStart + cut * rate) : element.trimStart,
    animations: rightAnimations,
  } as TimelineElement;
  const next = mapTrack(project, track.id, (current) => ({
    ...current,
    elements: current.elements.flatMap((item) => (item.id === element.id ? [left, right] : [item])),
  }) as TimelineTrack);
  return { project: next, ref: { trackId: track.id, elementId: right.id } };
}

/** Sets the transition from a main-track clip into the next one (`none` removes it). */
export function setTransition(
  project: EditorProject,
  ref: ElementRef,
  type: string,
  seconds: number,
): EditorProject {
  if (ref.trackId !== MAIN_TRACK_ID || !findElement(project, ref)) return project;
  let next = setParam(project, ref, 'transition.type', type);
  next = setParam(next, ref, 'transition.duration', seconds);
  return packMain(next);
}

export function deleteElement(project: EditorProject, ref: ElementRef): EditorProject {
  const next = removeFrom(project, ref);
  return pruneTracks(ref.trackId === MAIN_TRACK_ID ? packMain(next) : next);
}

/** A number param's value as saved, before keyframes (mask params included). */
export function baseNumber(element: TimelineElement, path: string): number {
  const maskKey = maskKeyOf(path);
  if (maskKey) return maskValue(element, maskKey);
  const value = element.params[path];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function mapElement(project: EditorProject, ref: ElementRef, map: (element: TimelineElement) => TimelineElement) {
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.map((element) => (element.id === ref.elementId ? map(element) : element)),
  }) as TimelineTrack);
}

/** Gives a clip or still a mask of `shape` (`none` removes it). */
export function setMaskShape(project: EditorProject, ref: ElementRef, shape: MaskShape): EditorProject {
  return mapElement(project, ref, (element) => withMaskShape(element, shape));
}

export function setParam(project: EditorProject, ref: ElementRef, key: string, value: ParamValue): EditorProject {
  const maskKey = key === 'mask.inverted' ? 'inverted' : maskKeyOf(key);
  if (maskKey) return mapElement(project, ref, (element) => withMaskParam(element, maskKey, value as number | boolean));
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.map((element) =>
      element.id === ref.elementId
        ? ({
            ...element,
            name: element.type === 'text' && key === 'content' ? String(value) : element.name,
            params: { ...element.params, [key]: value },
          } as TimelineElement)
        : element,
    ),
  }) as TimelineTrack);
}

export function setSourceAudio(project: EditorProject, ref: ElementRef, enabled: boolean): EditorProject {
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.map((element) =>
      element.id === ref.elementId && element.type === 'video' ? { ...element, isSourceAudioEnabled: enabled } : element,
    ),
  }) as TimelineTrack);
}

/**
 * Plays a clip faster or slower. The clip shows the same stretch of source,
 * so it gets shorter or longer on the timeline. A clip given a speed for the
 * first time keeps its pitch; one that already has a speed keeps its Keep
 * pitch setting (clips from before Keep pitch stay pitch-shifted).
 */
export function setSpeed(project: EditorProject, ref: ElementRef, rate: number): EditorProject {
  const found = findElement(project, ref);
  if (!found || (found.element.type !== 'video' && found.element.type !== 'audio')) return project;
  const { track, element } = found;
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
  const span = element.duration * rateOf(element);
  const duration = at(span / speed);
  const scale = duration / element.duration;
  let animations = element.animations;
  // Keyframes keep their place in the source, so they stretch with the clip.
  for (const key of getElementKeyframes({ animations })) {
    animations = retimeElementKeyframe({
      animations,
      propertyPath: key.propertyPath,
      keyframeId: key.id,
      time: at(key.time * scale),
    });
  }
  const keepPitch = 'retime' in element && element.retime ? element.retime.maintainPitch !== false : true;
  const next = {
    ...element,
    duration,
    retime: speed === 1 ? undefined : { rate: speed, maintainPitch: keepPitch },
    animations,
  } as TimelineElement;
  if (track.id === MAIN_TRACK_ID)
    return packMain(
      mapTrack(project, track.id, (current) => ({
        ...current,
        elements: current.elements.map((item) => (item.id === element.id ? next : item)),
      }) as TimelineTrack),
    );
  const { ceiling } = neighbours(track, element);
  const removed = removeFrom(project, ref);
  if (next.startTime + next.duration <= ceiling)
    return putOnTrack(removed, track.id, next);
  return pruneTracks(placeFree(removed, track.id, next).project);
}

/** Turns Keep pitch on or off for a sped-up or slowed clip. */
export function setKeepPitch(project: EditorProject, ref: ElementRef, keep: boolean): EditorProject {
  return mapElement(project, ref, (element) =>
    'retime' in element && element.retime ? ({ ...element, retime: { ...element.retime, maintainPitch: keep } } as TimelineElement) : element,
  );
}

/** Time inside the clip, in ticks, for a playhead at `seconds` (clamped to the clip). */
export function localTicks(element: TimelineElement, seconds: number): MediaTime {
  return at(Math.min(element.duration, Math.max(0, ticks(seconds) - element.startTime)));
}

export function hasKeyframes(element: TimelineElement, path: AnimationPath): boolean {
  return getElementKeyframes({ animations: element.animations }).some((key) => key.propertyPath === path);
}

export function keyframeAt(element: TimelineElement, path: AnimationPath, seconds: number) {
  return getKeyframeAtTime({ animations: element.animations, propertyPath: path, time: localTicks(element, seconds) });
}

/** Sets a keyframe for `path` at the playhead (replacing one already there). */
export function setKeyframe(
  project: EditorProject,
  ref: ElementRef,
  path: AnimationPath,
  seconds: number,
  value: number | string,
): EditorProject {
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.map((element) => {
      if (element.id !== ref.elementId) return element;
      const maskKey = maskKeyOf(path);
      const param = maskKey ? MASK_PARAMS[maskKey] : getElementParam({ element, key: path });
      if (!param) return element;
      return {
        ...element,
        animations: upsertPathKeyframe({
          animations: element.animations,
          propertyPath: path,
          time: localTicks(element, seconds),
          value,
          channelLayout: getParamChannelLayout({ param }),
          coerceValue: ({ value: next }) => coerceParamValue({ param, value: next }),
        }),
      } as TimelineElement;
    }),
  }) as TimelineTrack);
}

export function removeKeyframe(project: EditorProject, ref: ElementRef, path: AnimationPath, seconds: number) {
  const found = findElement(project, ref);
  const key = found && keyframeAt(found.element, path, seconds);
  if (!key) return project;
  return mapTrack(project, ref.trackId, (track) => ({
    ...track,
    elements: track.elements.map((element) =>
      element.id === ref.elementId
        ? ({
            ...element,
            animations: removeElementKeyframe({ animations: element.animations, propertyPath: path, keyframeId: key.id }),
          } as TimelineElement)
        : element,
    ),
  }) as TimelineTrack);
}

export function setTrackFlag(
  project: EditorProject,
  trackId: string,
  flag: 'muted' | 'hidden',
  value: boolean,
): EditorProject {
  return mapTrack(project, trackId, (track) => (flag in track ? { ...track, [flag]: value } : track) as TimelineTrack);
}

export type { TextTrack };
