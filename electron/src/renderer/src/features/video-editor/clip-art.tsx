/**
 * What a clip looks like on the timeline: a strip of its picture for clips and
 * stills, a waveform for anything with sound. Both are computed once per file.
 */
import { useEffect, useState } from 'react';
import { apiPath } from '@/lib/api/client';
import { mediaPeaks } from './engine';
import type { EditorMedia } from './project';

const posters = new Map<string, Promise<string | null>>();
const POSTER_HEIGHT = 64;

function grabPoster(media: EditorMedia): Promise<string | null> {
  return new Promise((resolve) => {
    const draw = (source: CanvasImageSource, width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.height = POSTER_HEIGHT;
      canvas.width = Math.max(1, Math.round((POSTER_HEIGHT * width) / Math.max(1, height)));
      canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    if (media.kind === 'image') {
      const image = new Image();
      image.onload = () => draw(image, image.naturalWidth, image.naturalHeight);
      image.onerror = () => resolve(null);
      image.src = apiPath(media.url);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (media.duration ?? 1) / 2);
    };
    video.onseeked = () => draw(video, video.videoWidth, video.videoHeight);
    video.onerror = () => resolve(null);
    video.src = apiPath(media.url);
  });
}

export function useMediaPoster(media: EditorMedia | undefined): string | null {
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    if (!media || media.kind === 'audio') return;
    let alive = true;
    let pending = posters.get(media.id);
    if (!pending) {
      pending = grabPoster(media);
      posters.set(media.id, pending);
    }
    void pending.then((value) => alive && setPoster(value));
    return () => {
      alive = false;
    };
  }, [media]);
  return poster;
}

export function usePeaks(media: EditorMedia | undefined): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!media || media.kind === 'image' || media.has_audio === false) return;
    let alive = true;
    void mediaPeaks(media).then((value) => alive && setPeaks(value));
    return () => {
      alive = false;
    };
  }, [media]);
  return peaks;
}

/**
 * The part of a file's waveform a clip plays: `offset` seconds in, for
 * `seconds` of source, drawn across the clip's width.
 */
export function Waveform({
  peaks,
  sourceSeconds,
  offset,
  seconds,
}: {
  peaks: Float32Array;
  sourceSeconds: number;
  offset: number;
  seconds: number;
}) {
  const bars = 120;
  const perSecond = peaks.length / Math.max(0.001, sourceSeconds);
  const points: string[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((offset + (seconds * i) / bars) * perSecond);
    const to = Math.max(from + 1, Math.floor((offset + (seconds * (i + 1)) / bars) * perSecond));
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
    const height = Math.max(0.02, peak);
    points.push(`M${i + 0.5} ${1 - height}V${1 + height}`);
  }
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 w-full text-foreground/40"
      viewBox={`0 0 ${bars} 2`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={points.join('')} stroke="currentColor" strokeWidth={0.6} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
