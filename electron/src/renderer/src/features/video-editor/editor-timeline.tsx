/**
 * The multi-track timeline: overlay and text tracks on top, the magnetic main
 * track in the middle, audio below. Drag a clip to move it (across tracks of
 * its kind), drag an edge to trim, click the ruler to seek. Edits are only
 * committed on release, so each drag is one undo step.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { Volume2 as Volume2Shape, VolumeX as VolumeXShape } from 'lucide';
import { MorphIcon } from '@/components/ui/morph-icon';
import { Button } from '@/components/ui/button';
import type { TimelineElement, TimelineTrack } from '@/lib/opencut/vendor/timeline/types';
import { getElementKeyframes } from '@/lib/opencut/vendor/animation/keyframe-query';
import { cn } from '@/lib/utils';
import {
  MAIN_TRACK_ID,
  allTracks,
  findMedia,
  projectSeconds,
  secondsOf,
  type EditorProject,
  type ElementRef,
} from './project';
import { formatTime } from './format';
import { useMediaPoster, usePeaks, Waveform } from './clip-art';

export const RULER_HEIGHT = 24;
const LANE_HEIGHT = 40;
const MAIN_LANE_HEIGHT = 56;
const GUTTER = 120;
const EDGE = 6;
const SNAP_PIXELS = 8;

type Drag =
  | { kind: 'move'; ref: ElementRef; pointerX: number; start: number; duration: number; targetTrackId: string; dx: number }
  | { kind: 'trim'; ref: ElementRef; edge: 'start' | 'end'; pointerX: number; start: number; end: number; dx: number }
  | { kind: 'seek' };

export interface TimelineEdits {
  move: (ref: ElementRef, seconds: number, trackId: string) => void;
  trim: (ref: ElementRef, edge: 'start' | 'end', seconds: number) => void;
  select: (ref: ElementRef | null) => void;
  seek: (seconds: number) => void;
  toggleTrack: (trackId: string, flag: 'muted' | 'hidden', value: boolean) => void;
}

const laneHeight = (track: TimelineTrack) => (track.id === MAIN_TRACK_ID ? MAIN_LANE_HEIGHT : LANE_HEIGHT);

function clipTone(element: TimelineElement): string {
  switch (element.type) {
    case 'text':
      return 'bg-secondary text-secondary-foreground';
    case 'audio':
      return 'bg-muted text-foreground';
    case 'image':
      return 'bg-accent text-accent-foreground';
    default:
      return 'bg-card text-card-foreground';
  }
}

function clipLabel(project: EditorProject, element: TimelineElement): string {
  if (element.type === 'text') return String(element.params.content ?? element.name);
  if ('mediaId' in element) return findMedia(project, element.mediaId)?.name ?? element.name;
  return element.name;
}

/** A clip's picture strip and waveform, behind its label. */
function ClipArt({ project, element }: { project: EditorProject; element: TimelineElement }) {
  const media = 'mediaId' in element ? findMedia(project, element.mediaId) : undefined;
  const poster = useMediaPoster(media);
  const peaks = usePeaks(element.type === 'video' && element.isSourceAudioEnabled === false ? undefined : media);
  const rate = 'retime' in element && element.retime ? element.retime.rate : 1;
  return (
    <>
      {poster && (
        <span
          className="pointer-events-none absolute inset-0 bg-repeat-x opacity-60"
          style={{ backgroundImage: `url(${poster})`, backgroundSize: 'auto 100%' }}
          aria-hidden
        />
      )}
      {peaks && media?.duration ? (
        <Waveform
          peaks={peaks}
          sourceSeconds={media.duration}
          offset={secondsOf(element.trimStart)}
          seconds={secondsOf(element.duration) * rate}
        />
      ) : null}
    </>
  );
}

export function EditorTimeline({
  project,
  selection,
  playhead,
  pixelsPerSecond,
  onZoom,
  edits,
}: {
  project: EditorProject;
  selection: ElementRef | null;
  playhead: number;
  pixelsPerSecond: number;
  onZoom: (next: number) => void;
  edits: TimelineEdits;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const tracks = allTracks(project);
  const length = Math.max(projectSeconds(project), playhead) + 5;
  const width = Math.max(length * pixelsPerSecond, 400);

  /** Every clip edge and the playhead, for snapping. */
  const snapPoints = useMemo(() => {
    const points = [0, playhead];
    for (const track of tracks)
      for (const element of track.elements)
        points.push(secondsOf(element.startTime), secondsOf(element.startTime + element.duration));
    return points;
  }, [tracks, playhead]);

  const snap = (seconds: number, exclude: ElementRef | null) => {
    const own = exclude
      ? tracks
          .find((track) => track.id === exclude.trackId)
          ?.elements.find((element) => element.id === exclude.elementId)
      : null;
    const ownEdges = own ? [secondsOf(own.startTime), secondsOf(own.startTime + own.duration)] : [];
    let best = seconds;
    let distance = SNAP_PIXELS / pixelsPerSecond;
    for (const point of snapPoints) {
      if (ownEdges.includes(point)) continue;
      const gap = Math.abs(point - seconds);
      if (gap < distance) {
        distance = gap;
        best = point;
      }
    }
    return best;
  };

  const secondsAt = (clientX: number) => {
    const box = scroller.current!.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + scroller.current!.scrollLeft - GUTTER) / pixelsPerSecond);
  };

  const trackAt = (clientY: number): string | null => {
    const lanes = scroller.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [];
    for (const lane of lanes) {
      const box = lane.getBoundingClientRect();
      if (clientY >= box.top && clientY < box.bottom) return lane.dataset.trackId ?? null;
    }
    return null;
  };

  // Keep the playhead in view while it plays or after a jump (not when a drag ends).
  const dragging = useRef(false);
  dragging.current = drag !== null && drag.kind !== 'seek';
  useEffect(() => {
    const view = scroller.current;
    if (!view || dragging.current) return;
    const x = GUTTER + playhead * pixelsPerSecond;
    const visible = view.clientWidth - GUTTER;
    if (x < view.scrollLeft + GUTTER || x > view.scrollLeft + view.clientWidth - 24)
      view.scrollLeft = Math.max(0, x - GUTTER - visible * 0.2);
  }, [playhead, pixelsPerSecond]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      if (drag.kind === 'seek') {
        edits.seek(secondsAt(event.clientX));
        return;
      }
      if (drag.kind === 'move')
        setDrag({ ...drag, dx: event.clientX - drag.pointerX, targetTrackId: trackAt(event.clientY) ?? drag.targetTrackId });
      else setDrag({ ...drag, dx: event.clientX - drag.pointerX });
    };
    const onUp = () => {
      if (drag.kind === 'move' && Math.abs(drag.dx) + (drag.targetTrackId !== drag.ref.trackId ? 99 : 0) > 2) {
        let start = Math.max(0, drag.start + drag.dx / pixelsPerSecond);
        const snappedStart = snap(start, drag.ref);
        const snappedEnd = snap(start + drag.duration, drag.ref) - drag.duration;
        start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
        edits.move(drag.ref, Math.max(0, start), drag.targetTrackId);
      }
      if (drag.kind === 'trim' && Math.abs(drag.dx) > 1) {
        const base = drag.edge === 'start' ? drag.start : drag.end;
        edits.trim(drag.ref, drag.edge, snap(base + drag.dx / pixelsPerSecond, drag.ref));
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  const startClipDrag = (event: ReactPointerEvent, track: TimelineTrack, element: TimelineElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const ref = { trackId: track.id, elementId: element.id };
    edits.select(ref);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = event.clientX - box.left;
    const start = secondsOf(element.startTime);
    const end = secondsOf(element.startTime + element.duration);
    if (offset <= EDGE || box.right - event.clientX <= EDGE)
      setDrag({ kind: 'trim', ref, edge: offset <= EDGE ? 'start' : 'end', pointerX: event.clientX, start, end, dx: 0 });
    else
      setDrag({
        kind: 'move',
        ref,
        pointerX: event.clientX,
        start,
        duration: end - start,
        targetTrackId: track.id,
        dx: 0,
      });
  };

  const clipBox = (track: TimelineTrack, element: TimelineElement) => {
    let left = secondsOf(element.startTime) * pixelsPerSecond;
    let width = secondsOf(element.duration) * pixelsPerSecond;
    if (drag && drag.kind !== 'seek' && drag.ref.elementId === element.id) {
      if (drag.kind === 'move' && drag.targetTrackId === track.id) left += drag.dx;
      if (drag.kind === 'trim' && drag.edge === 'start') {
        left += drag.dx;
        width -= drag.dx;
      }
      if (drag.kind === 'trim' && drag.edge === 'end') width += drag.dx;
    }
    return { left, width: Math.max(2, width) };
  };

  const ticks = useMemo(() => {
    const step = pixelsPerSecond >= 120 ? 0.5 : pixelsPerSecond >= 40 ? 1 : pixelsPerSecond >= 15 ? 5 : 10;
    const marks: number[] = [];
    for (let at = 0; at <= length; at += step) marks.push(Number(at.toFixed(2)));
    return marks;
  }, [pixelsPerSecond, length]);

  return (
    <div
      ref={scroller}
      className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background select-none"
      onWheel={(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        onZoom(pixelsPerSecond * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
      }}
    >
      <div className="relative" style={{ width: width + GUTTER }}>
        <div
          className="sticky top-0 z-20 flex border-b border-border bg-background"
          style={{ height: RULER_HEIGHT }}
        >
          <div className="sticky left-0 z-10 shrink-0 bg-background" style={{ width: GUTTER }} />
          <div
            className="relative flex-1 cursor-pointer"
            aria-label={t('editor.ruler')}
            onPointerDown={(event) => {
              edits.seek(secondsAt(event.clientX));
              setDrag({ kind: 'seek' });
            }}
          >
            {ticks.map((at) => (
              <span
                key={at}
                className="absolute top-0 h-full border-l border-border pl-1 text-[10px] tabular-nums text-muted-foreground"
                style={{ left: at * pixelsPerSecond }}
              >
                {Number.isInteger(at) ? formatTime(at, false) : ''}
              </span>
            ))}
          </div>
        </div>
        {tracks.map((track) => (
          <div
            key={track.id}
            data-track-id={track.id}
            className={cn(
              'relative flex border-b border-border/60',
              drag?.kind === 'move' && drag.targetTrackId === track.id && 'bg-muted/40',
            )}
            style={{ height: laneHeight(track) }}
          >
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-background px-2 text-[11px] text-muted-foreground"
              style={{ width: GUTTER }}
            >
              <span className="min-w-0 flex-1 truncate">
                {t(
                  track.id === MAIN_TRACK_ID
                    ? 'editor.track_main'
                    : track.type === 'audio'
                      ? 'editor.track_audio'
                      : track.type === 'text'
                        ? 'editor.track_text'
                        : 'editor.track_overlay',
                )}
              </span>
              {'muted' in track && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t(track.muted ? 'editor.unmute_track' : 'editor.mute_track')}
                  aria-pressed={track.muted}
                  onClick={() => edits.toggleTrack(track.id, 'muted', !track.muted)}
                >
                  <MorphIcon className="size-3.5" icon={track.muted ? VolumeXShape : Volume2Shape} />
                </Button>
              )}
              {'hidden' in track && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t(track.hidden ? 'editor.show_track' : 'editor.hide_track')}
                  aria-pressed={track.hidden}
                  onClick={() => edits.toggleTrack(track.id, 'hidden', !track.hidden)}
                >
                  {track.hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
                </Button>
              )}
            </div>
            <div className="relative flex-1" onPointerDown={() => edits.select(null)}>
              {track.elements.map((element) => {
                const box = clipBox(track, element);
                const selected = selection?.elementId === element.id;
                const keyframes = selected ? getElementKeyframes({ animations: element.animations }) : [];
                return (
                  <div
                    key={element.id}
                    role="button"
                    tabIndex={-1}
                    data-clip-id={element.id}
                    data-selected={selected || undefined}
                    aria-label={clipLabel(project, element)}
                    className={cn(
                      'absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-lg border border-border px-2 py-1 text-[11px] leading-tight',
                      clipTone(element),
                      selected && 'ring-2 ring-foreground',
                      drag?.kind === 'move' && drag.ref.elementId === element.id && 'cursor-grabbing opacity-80',
                    )}
                    style={{ left: box.left, width: box.width }}
                    onPointerDown={(event) => startClipDrag(event, track, element)}
                  >
                    <ClipArt project={project} element={element} />
                    <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" aria-hidden />
                    <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" aria-hidden />
                    <span className="relative block truncate font-medium drop-shadow-sm">{clipLabel(project, element)}</span>
                    {'retime' in element && element.retime && element.retime.rate !== 1 && (
                      <span className="tabular-nums text-muted-foreground">{element.retime.rate}×</span>
                    )}
                    {keyframes.map((key) => (
                      <span
                        key={key.propertyPath + key.id}
                        className="absolute bottom-0.5 size-1.5 -translate-x-1/2 rotate-45 bg-foreground"
                        style={{ left: secondsOf(key.time) * pixelsPerSecond }}
                        aria-hidden
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-destructive"
          style={{ left: GUTTER + playhead * pixelsPerSecond }}
          aria-hidden
        />
      </div>
    </div>
  );
}
