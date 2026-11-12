import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MagnetIcon,
  PauseIcon,
  PlayIcon,
  Redo2Icon,
  ScissorsIcon,
  Trash2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiPath } from '@/lib/api/client';
import { beatSyncActive, musicOffset, type BeatGrid } from './beat-grid';
import { cn } from '@/lib/utils';
import type { PromoDraft } from './promo-model';
import { usePlayhead, type Playhead } from './playhead';
import {
  beatTimes,
  layoutTimeline,
  moveOverlay,
  moveShotTo,
  removeOverlay,
  removeShot,
  resizeShot,
  snap,
  snapToBeats,
  splitShotAt,
  trimShotStart,
} from './timeline-model';

export type Selection = { kind: 'shot' | 'overlay'; key: string } | null;

type Gesture =
  | {
      kind: 'shot';
      mode: 'start' | 'end' | 'move';
      key: string;
      pointerId: number;
      x: number;
      base: number;
    }
  | { kind: 'overlay'; key: string; pointerId: number; x: number; base: number }
  | { kind: 'scrub'; pointerId: number };

/** Live value of a drag, committed to the draft on release. */
type Live = {
  kind: 'shot' | 'overlay';
  mode: 'start' | 'end' | 'move';
  key: string;
  value: number;
} | null;

const TRACK = 44;
const LANE = 26;
const RULER = 22;
const MUSIC = 40;
/** Snap distance in pixels. */
const SNAP_PX = 8;

const fmt = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** Waveform peaks per media id, decoded once in the page. */
const peakCache = new Map<string, Promise<{ peaks: number[]; duration: number }>>();
function loadPeaks(url: string, id: string) {
  let pending = peakCache.get(id);
  if (!pending) {
    pending = (async () => {
      const bytes = await (await fetch(apiPath(url))).arrayBuffer();
      const context = new OfflineAudioContext(1, 1, 22050);
      const audio = await context.decodeAudioData(bytes);
      const data = audio.getChannelData(0);
      const buckets = Math.min(4000, Math.max(1, Math.ceil(audio.duration * 50)));
      const size = Math.max(1, Math.floor(data.length / buckets));
      const peaks: number[] = [];
      for (let b = 0; b < buckets; b++) {
        let max = 0;
        for (let i = b * size, end = Math.min(data.length, i + size); i < end; i++) {
          const v = Math.abs(data[i]);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      return { peaks, duration: audio.duration };
    })();
    peakCache.set(id, pending);
    pending.catch(() => peakCache.delete(id));
  }
  return pending;
}

function Waveform({
  draft,
  pps,
  length,
  offset,
}: {
  draft: PromoDraft;
  pps: number;
  length: number;
  /** Seconds into the file at video time 0 (the render starts the music on a beat). */
  offset: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [wave, setWave] = useState<{ peaks: number[]; duration: number } | null>(null);
  const music = draft.music;
  useEffect(() => {
    setWave(null);
    if (!music) return;
    let live = true;
    loadPeaks(music.url, music.id).then(
      (value) => live && setWave(value),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [music]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !wave) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.min(16000, Math.max(1, Math.round(length * pps)));
    element.width = Math.round(width * dpr);
    element.height = Math.round(MUSIC * dpr);
    element.style.width = `${width}px`;
    const context = element.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, element.width, element.height);
    context.fillStyle = getComputedStyle(element).color;
    const middle = element.height / 2;
    const perSecond = wave.peaks.length / wave.duration;
    // The music loops when it is shorter than the video, as in the render.
    for (let x = 0; x < element.width; x += 2) {
      const t = (x / dpr / pps + offset) % wave.duration;
      const peak = wave.peaks[Math.min(wave.peaks.length - 1, Math.floor(t * perSecond))] ?? 0;
      const h = Math.max(1, peak * middle * 0.9);
      context.fillRect(x, middle - h, 1.5 * dpr, h * 2);
    }
  }, [wave, pps, length, offset]);
  if (!music) return null;
  return (
    <canvas ref={canvas} className="pointer-events-none absolute left-0 top-0 text-primary/50" />
  );
}

function PlayheadLine({
  playhead,
  pps,
  height,
}: {
  playhead: Playhead;
  pps: number;
  height: number;
}) {
  const { time } = usePlayhead(playhead);
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 w-px bg-red-500"
      style={{ left: time * pps, height }}
      aria-hidden
    >
      <div className="-ml-1.5 size-3 rotate-45 bg-red-500" />
    </div>
  );
}

function TimeReadout({ playhead, length }: { playhead: Playhead; length: number }) {
  const { time } = usePlayhead(playhead);
  return (
    <span className="tabular-nums text-xs text-muted-foreground">
      {fmt(time)} / {fmt(length)}
    </span>
  );
}

function PlayButton({ playhead }: { playhead: Playhead }) {
  const { t } = useTranslation();
  const { playing } = usePlayhead(playhead);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={t(playing ? 'promo.timeline_pause' : 'promo.timeline_play')}
      onClick={() => playhead.setPlaying(!playing)}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </Button>
  );
}

export function PromoTimeline({
  draft,
  busy,
  playhead,
  selection,
  canUndo,
  canRedo,
  onSelect,
  onCommit,
  onUndo,
  onRedo,
  newKey,
  grid,
}: {
  draft: PromoDraft;
  busy: boolean;
  playhead: Playhead;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (selection: Selection) => void;
  onCommit: (next: PromoDraft) => void;
  onUndo: () => void;
  onRedo: () => void;
  newKey: () => string;
  /** The music's beat grid, fetched once by the page. */
  grid: BeatGrid;
}) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [live, setLive] = useState<Live>(null);
  const liveRef = useRef<Live>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [snapOn, setSnapOn] = useState(true);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const music = draft.music;
  const period = grid.period;

  // With Cut on the beat the render moves cuts onto the music's beats; apply
  // the same snapping here so the timeline shows what renders.
  const beatSync = beatSyncActive(draft, grid);
  const settle = (value: PromoDraft) => (beatSync ? snapToBeats(value, period) : value);
  const commit = (next: PromoDraft) => onCommit(settle(next));

  // Show the drag in progress without touching the saved draft.
  const shown = useMemo(() => {
    let edited = draft;
    if (live?.kind === 'overlay') edited = moveOverlay(draft, live.key, live.value);
    else if (live?.mode === 'end') edited = resizeShot(draft, live.key, live.value);
    else if (live?.mode === 'start') edited = trimShotStart(draft, live.key, live.value);
    else if (live) edited = moveShotTo(draft, live.key, live.value);
    return beatSync ? snapToBeats(edited, period) : edited;
  }, [draft, live, beatSync, period]);
  const layout = useMemo(() => layoutTimeline(shown), [shown]);
  const length = Math.max(layout.length, 1);
  const pps = Math.max(4, ((width - 24) / length) * zoom);
  const beats = useMemo(() => beatTimes(period, length), [period, length]);
  const height = RULER + TRACK + layout.lanes * LANE + (music ? MUSIC : 0) + 8;

  const candidates = (exclude?: string) => [
    ...(snapOn ? beats : []),
    ...layout.shots.filter((s) => s.key !== exclude).flatMap((s) => [s.start, s.end]),
    playhead.get().time,
  ];

  const setLiveValue = (value: Live) => {
    liveRef.current = value;
    setLive(value);
  };

  const begin = (event: React.PointerEvent, next: Gesture) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // preventDefault stops the click from focusing; focus the timeline so its
    // keys (Space, S, Delete, arrows, Ctrl+Z) work right after a click.
    viewport.current?.focus({ preventScroll: true });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    gesture.current = next;
  };

  const move = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    if (g.kind === 'scrub') {
      const rect = viewport.current!.getBoundingClientRect();
      const x = event.clientX - rect.left + viewport.current!.scrollLeft;
      playhead.seek(Math.min(length, Math.max(0, x / pps)));
      return;
    }
    const delta = (event.clientX - g.x) / pps;
    const tolerance = SNAP_PX / pps;
    if (g.kind === 'overlay') {
      setLiveValue({
        kind: 'overlay',
        mode: 'move',
        key: g.key,
        value: snap(g.base + delta, candidates(), tolerance),
      });
      return;
    }
    const block = layoutTimeline(draft).shots.find((s) => s.key === g.key)!;
    if (g.mode === 'end') {
      const end = snap(block.start + g.base + delta, candidates(g.key), tolerance);
      setLiveValue({ kind: 'shot', mode: 'end', key: g.key, value: end - block.start });
    } else if (g.mode === 'start') {
      setLiveValue({ kind: 'shot', mode: 'start', key: g.key, value: g.base + delta });
    } else {
      // Drop position: the shot whose middle is nearest the dragged middle.
      const centre = (block.start + block.end) / 2 + delta;
      const all = layoutTimeline(draft).shots;
      let index = 0;
      for (const s of all) if ((s.start + s.end) / 2 < centre && s.key !== g.key) index++;
      setLiveValue({
        kind: 'shot',
        mode: 'move',
        key: g.key,
        value: Math.min(index, all.length - 1),
      });
    }
  };

  const finish = (event: React.PointerEvent, keep = true) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    const value = liveRef.current;
    setLiveValue(null);
    if (keep && value) onCommit(shown);
  };

  const split = () => {
    const next = splitShotAt(draft, playhead.get().time, newKey());
    if (next !== draft) commit(next);
  };
  const remove = () => {
    if (!selection) return;
    commit(
      selection.kind === 'shot'
        ? removeShot(draft, selection.key)
        : removeOverlay(draft, selection.key),
    );
    onSelect(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (busy) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const mod = event.ctrlKey || event.metaKey;
    const step = event.shiftKey ? 1 : 0.1;
    if (event.key === ' ') {
      event.preventDefault();
      playhead.setPlaying(!playhead.get().playing);
    } else if (event.key.toLowerCase() === 's' && !mod) {
      event.preventDefault();
      split();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      onRedo();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const sign = event.key === 'ArrowLeft' ? -1 : 1;
      if (selection?.kind === 'overlay') {
        const block = layout.overlays.find((o) => o.key === selection.key);
        if (block) commit(moveOverlay(draft, selection.key, block.start + sign * step));
      } else if (selection?.kind === 'shot') {
        const shot = draft.shots.find((s) => s.key === selection.key);
        // On the beat grid a smaller step would snap straight back: move a beat.
        const by = beatSync ? period : step;
        if (shot) commit(resizeShot(draft, selection.key, shot.duration + sign * by));
      } else {
        playhead.seek(Math.min(length, playhead.get().time + sign * step));
      }
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setZoom((z) => Math.min(32, Math.max(1, event.deltaY < 0 ? z * 1.25 : z / 1.25)));
  };

  const tick = length > 60 ? 10 : length > 20 ? 5 : pps > 120 ? 0.5 : 1;
  const ticks = Array.from({ length: Math.floor(length / tick) + 1 }, (_, i) => i * tick);

  return (
    <section className="space-y-1.5" aria-label={t('promo.timeline_title')}>
      <div className="flex flex-wrap items-center gap-1">
        <PlayButton playhead={playhead} />
        <TimeReadout playhead={playhead} length={layout.length} />
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_split')}
          title={t('promo.timeline_split')}
          disabled={busy}
          onClick={split}
        >
          <ScissorsIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_delete')}
          title={t('promo.timeline_delete')}
          disabled={busy || !selection}
          onClick={remove}
        >
          <Trash2Icon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_undo')}
          title={t('promo.timeline_undo')}
          disabled={busy || !canUndo}
          onClick={onUndo}
        >
          <Undo2Icon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_redo')}
          title={t('promo.timeline_redo')}
          disabled={busy || !canRedo}
          onClick={onRedo}
        >
          <Redo2Icon />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          size="icon-sm"
          variant={snapOn ? 'secondary' : 'ghost'}
          aria-label={t('promo.timeline_snap')}
          title={t('promo.timeline_snap')}
          aria-pressed={snapOn}
          onClick={() => setSnapOn((on) => !on)}
        >
          <MagnetIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_zoom_out')}
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => Math.max(1, z / 2))}
        >
          <ZoomOutIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.timeline_zoom_in')}
          disabled={zoom >= 32}
          onClick={() => setZoom((z) => Math.min(32, z * 2))}
        >
          <ZoomInIcon />
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t('promo.timeline_hint')}
        </span>
      </div>
      <div
        ref={viewport}
        role="application"
        aria-label={t('promo.timeline_keys')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        className="relative overflow-x-auto overflow-y-hidden rounded-md border border-border/60 bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height }}
      >
        <div className="relative" style={{ width: Math.max(width - 2, length * pps + 24), height }}>
          {/* Ruler: click or drag to move the playhead. */}
          <div
            className="absolute inset-x-0 top-0 cursor-ew-resize border-b border-border/60"
            style={{ height: RULER }}
            onPointerDown={(event) => {
              begin(event, { kind: 'scrub', pointerId: event.pointerId });
              move(event);
            }}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={(event) => finish(event, false)}
          >
            {ticks.map((at) => (
              <span
                key={at}
                className="absolute top-0 h-full border-l border-border/60 pl-0.5 text-[10px] text-muted-foreground"
                style={{ left: at * pps }}
              >
                {fmt(at).replace(/\.0$/, '')}
              </span>
            ))}
          </div>
          {/* Beat lines across every track. */}
          {beats.map((at) => (
            <div
              key={at}
              className="pointer-events-none absolute w-px bg-primary/15"
              style={{ left: at * pps, top: RULER, bottom: 0 }}
            />
          ))}
          {/* Video track. */}
          <div className="absolute inset-x-0" style={{ top: RULER + 2, height: TRACK - 4 }}>
            {layout.shots.map((block) => {
              const selected = selection?.kind === 'shot' && selection.key === block.key;
              const image = block.shot.media.kind === 'image';
              return (
                <div
                  key={block.key}
                  data-shot={block.key}
                  className={cn(
                    'absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded-sm border bg-sky-700/70 text-[11px] text-white active:cursor-grabbing',
                    selected ? 'z-10 border-white ring-2 ring-primary' : 'border-sky-950/60',
                  )}
                  style={{
                    left: block.start * pps,
                    width: Math.max(4, (block.end - block.start) * pps),
                    backgroundImage: image ? `url("${apiPath(block.shot.media.url)}")` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  onPointerDown={(event) => {
                    onSelect({ kind: 'shot', key: block.key });
                    begin(event, {
                      kind: 'shot',
                      mode: 'move',
                      key: block.key,
                      pointerId: event.pointerId,
                      x: event.clientX,
                      base: block.index,
                    });
                  }}
                  onPointerMove={move}
                  onPointerUp={finish}
                  onPointerCancel={(event) => finish(event, false)}
                >
                  {!image && (
                    <div
                      data-edge="start"
                      className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60"
                      onPointerDown={(event) => {
                        onSelect({ kind: 'shot', key: block.key });
                        begin(event, {
                          kind: 'shot',
                          mode: 'start',
                          key: block.key,
                          pointerId: event.pointerId,
                          x: event.clientX,
                          base: block.shot.start,
                        });
                      }}
                      onPointerMove={move}
                      onPointerUp={finish}
                      onPointerCancel={(event) => finish(event, false)}
                    />
                  )}
                  <span className="truncate px-2.5 drop-shadow">
                    {block.index + 1}. {block.shot.media.name}
                  </span>
                  <div
                    data-edge="end"
                    className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60"
                    onPointerDown={(event) => {
                      onSelect({ kind: 'shot', key: block.key });
                      begin(event, {
                        kind: 'shot',
                        mode: 'end',
                        key: block.key,
                        pointerId: event.pointerId,
                        x: event.clientX,
                        base: block.shot.duration,
                      });
                    }}
                    onPointerMove={move}
                    onPointerUp={finish}
                    onPointerCancel={(event) => finish(event, false)}
                  />
                </div>
              );
            })}
            {layout.outro && (
              <div
                className="absolute top-0 flex h-full items-center overflow-hidden rounded-sm border border-border/60 bg-neutral-800 px-2 text-[11px] text-white/80"
                style={{
                  left: layout.outro.start * pps,
                  width: Math.max(4, (layout.outro.end - layout.outro.start) * pps),
                }}
              >
                <span className="truncate">{t('promo.timeline_outro')}</span>
              </div>
            )}
          </div>
          {/* Overlay lanes. */}
          <div
            className="absolute inset-x-0"
            style={{ top: RULER + TRACK, height: layout.lanes * LANE }}
          >
            {layout.overlays.map((block) => {
              const selected = selection?.kind === 'overlay' && selection.key === block.key;
              return (
                <div
                  key={block.key}
                  data-overlay={block.key}
                  title={block.problem ? t(`promo.anim_warn_${block.problem}`) : undefined}
                  className={cn(
                    'absolute flex cursor-grab items-center overflow-hidden rounded-sm border px-1.5 text-[11px] active:cursor-grabbing',
                    block.problem
                      ? 'border-destructive bg-destructive/40 text-white'
                      : 'border-amber-900/60 bg-amber-500/80 text-black',
                    selected && 'z-10 ring-2 ring-primary',
                  )}
                  style={{
                    left: block.start * pps,
                    width: Math.max(6, (block.end - block.start) * pps),
                    top: block.lane * LANE + 2,
                    height: LANE - 4,
                  }}
                  onPointerDown={(event) => {
                    onSelect({ kind: 'overlay', key: block.key });
                    begin(event, {
                      kind: 'overlay',
                      key: block.key,
                      pointerId: event.pointerId,
                      x: event.clientX,
                      base: block.start,
                    });
                  }}
                  onPointerMove={move}
                  onPointerUp={finish}
                  onPointerCancel={(event) => finish(event, false)}
                >
                  <span className="truncate">{block.overlay.label}</span>
                </div>
              );
            })}
          </div>
          {/* Music track. */}
          {music && (
            <div
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: RULER + TRACK + layout.lanes * LANE, height: MUSIC }}
            >
              <Waveform draft={draft} pps={pps} length={length} offset={musicOffset(draft, grid)} />
              <span className="absolute left-1 top-0.5 text-[10px] text-muted-foreground">
                {music.name}
              </span>
            </div>
          )}
          <PlayheadLine playhead={playhead} pps={pps} height={height} />
        </div>
      </div>
    </section>
  );
}
