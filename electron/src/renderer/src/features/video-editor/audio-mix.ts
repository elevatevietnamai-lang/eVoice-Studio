/**
 * The editor's sound: every clip with audio becomes a segment, and the same
 * schedule plays the preview (AudioContext) and renders the export
 * (OfflineAudioContext), so what you hear is what you export.
 *
 * Speed changes play the source faster or slower, which also changes its
 * pitch: the time-stretch library OpenCut uses (soundtouchjs) is LGPL and is
 * not shipped.
 */
import { resolveNumberAtTime } from '@/lib/opencut/vendor/animation/values';
import type { ElementAnimations } from '@/lib/opencut/vendor/animation/types';
import type { TimelineElement } from '@/lib/opencut/vendor/timeline/types';
import { findMedia, secondsOf, ticks, type EditorProject } from './project';
import { rateOf } from './timeline-ops';

export interface AudioSegment {
  mediaId: string;
  /** Timeline seconds where the clip starts, and how long it lasts. */
  start: number;
  duration: number;
  /** Seconds into the source where the clip starts. */
  offset: number;
  rate: number;
  volumeDb: number;
  fadeIn: number;
  fadeOut: number;
  animations: ElementAnimations | undefined;
}

/** Gain curve resolution: enough for keyframed volume and fades. */
const CURVE_STEPS_PER_SECOND = 50;

const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function segmentFor(element: TimelineElement): AudioSegment | null {
  if ((element.type !== 'video' && element.type !== 'audio') || element.params.muted === true) return null;
  if (element.type === 'video' && element.isSourceAudioEnabled === false) return null;
  // OpenCut's library sounds come from its cloud; the editor only plays uploads.
  if (element.type === 'audio' && element.sourceType !== 'upload') return null;
  return {
    mediaId: element.mediaId,
    start: secondsOf(element.startTime),
    duration: secondsOf(element.duration),
    offset: secondsOf(element.trimStart),
    rate: rateOf(element),
    volumeDb: number(element.params.volume),
    fadeIn: Math.max(0, number(element.params.fadeIn)),
    fadeOut: Math.max(0, number(element.params.fadeOut)),
    animations: element.animations,
  };
}

/** Every clip whose sound reaches the mix, muted tracks and silent files left out. */
export function audioSegments(project: EditorProject): AudioSegment[] {
  const segments: AudioSegment[] = [];
  const tracks = [project.tracks.main, ...project.tracks.overlay, ...project.tracks.audio];
  for (const track of tracks) {
    if ('muted' in track && track.muted) continue;
    for (const element of track.elements) {
      const segment = segmentFor(element);
      if (!segment) continue;
      const media = findMedia(project, segment.mediaId);
      if (!media || media.kind === 'image' || media.has_audio === false) continue;
      segments.push(segment);
    }
  }
  return segments;
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20));

/** Linear gain `local` seconds into a segment: keyframed volume times the fades. */
export function gainAt(segment: AudioSegment, local: number): number {
  const db = resolveNumberAtTime({
    baseValue: segment.volumeDb,
    animations: segment.animations,
    propertyPath: 'volume',
    localTime: ticks(local),
  });
  let fade = 1;
  if (segment.fadeIn > 0) fade = Math.min(fade, local / segment.fadeIn);
  if (segment.fadeOut > 0) fade = Math.min(fade, (segment.duration - local) / segment.fadeOut);
  return dbToGain(db) * Math.max(0, Math.min(1, fade));
}

/**
 * Starts every segment that is still to play after timeline second `from`,
 * with timeline second `from` heard at context time `when`. Returns the
 * sources so a pause can stop them.
 */
export function scheduleSegments(
  context: BaseAudioContext,
  segments: AudioSegment[],
  buffers: ReadonlyMap<string, AudioBuffer | null>,
  from: number,
  when: number,
  destination: AudioNode = context.destination,
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (const segment of segments) {
    const buffer = buffers.get(segment.mediaId);
    const end = segment.start + segment.duration;
    if (!buffer || end <= from) continue;
    const local = Math.max(0, from - segment.start);
    const remaining = segment.duration - local;
    if (remaining <= 0.01) continue;
    const startAt = when + Math.max(0, segment.start - from);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = segment.rate;
    const gain = context.createGain();
    const steps = Math.max(2, Math.ceil(remaining * CURVE_STEPS_PER_SECOND) + 1);
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = gainAt(segment, local + (remaining * i) / (steps - 1));
    gain.gain.setValueCurveAtTime(curve, startAt, remaining);
    source.connect(gain).connect(destination);
    source.start(startAt, segment.offset + local * segment.rate, remaining * segment.rate);
    sources.push(source);
  }
  return sources;
}
