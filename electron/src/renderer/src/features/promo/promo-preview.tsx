import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPath } from '@/lib/api/client';
import { clampTransition, SHAPE_SIZE, type PromoDraft, type PromoLook } from './promo-model';
import { usePlayhead, type Playhead } from './playhead';
import { layoutTimeline } from './timeline-model';

/** Approximations of the backend's colour looks (services/promo_video.py LOOKS). */
const LOOK_FILTER: Record<PromoLook, string> = {
  none: 'none',
  warm: 'sepia(0.18) saturate(1.1)',
  cool: 'hue-rotate(-8deg) saturate(0.95) brightness(1.02)',
  vivid: 'contrast(1.08) saturate(1.25)',
  mono: 'grayscale(1) contrast(1.1)',
};

const CORNER_STYLE: Record<string, React.CSSProperties> = {
  top_left: { top: '3%', left: '3%' },
  top_center: { top: '3%', left: '50%', transform: 'translateX(-50%)' },
  top_right: { top: '3%', right: '3%' },
  bottom_left: { bottom: '3%', left: '3%' },
  bottom_center: { bottom: '3%', left: '50%', transform: 'translateX(-50%)' },
  bottom_right: { bottom: '3%', right: '3%' },
};

/** How far a media element may drift from the clock before it is re-seeked. */
const DRIFT = 0.15;

function sync(element: HTMLMediaElement | null, at: number, playing: boolean, visible: boolean) {
  if (!element) return;
  const want = Math.max(0, at);
  const run = playing && visible;
  if (Math.abs(element.currentTime - want) > (run ? DRIFT : 0.04)) element.currentTime = want;
  if (run && element.paused) void element.play().catch(() => {});
  if (!run && !element.paused) element.pause();
}

/**
 * Approximate live preview of the draft at the playhead: shots cross-fade
 * over their transitions, overlays play as alpha video, music loops. Looks,
 * still zooms, the blurred background behind "whole picture" and the shapes
 * of transitions are only approximated; the rendered video is exact.
 */
export function PromoPreview({
  draft,
  playhead,
  musicStart,
  width,
}: {
  draft: PromoDraft;
  playhead: Playhead;
  /** Seconds into the music file at video time 0, as the render starts it. */
  musicStart: number;
  width: number;
}) {
  const { t } = useTranslation();
  const { time, playing } = usePlayhead(playhead);
  const layout = useMemo(() => layoutTimeline(draft), [draft]);
  const size = SHAPE_SIZE[draft.shape];
  const height = Math.round((width * size.height) / size.width);
  const media = useRef(new Map<string, HTMLMediaElement>());
  const music = useRef<HTMLAudioElement>(null);
  const narration = useRef<HTMLAudioElement>(null);

  // The clock reads wall time from an anchor, so it stays right however often
  // it ticks. requestAnimationFrame gives smooth frames; the interval keeps it
  // going when the window is hidden or occluded and frames stop, while the
  // music plays on. A seek made while playing moves the anchor.
  useEffect(() => {
    if (!playing) return;
    if (playhead.get().time >= layout.length - 0.01) playhead.seek(0);
    let anchor = { time: playhead.get().time, at: performance.now() };
    let shown = anchor.time;
    let frame = 0;
    const tick = () => {
      const current = playhead.get().time;
      if (Math.abs(current - shown) > 0.05) anchor = { time: current, at: performance.now() };
      const next = anchor.time + (performance.now() - anchor.at) / 1000;
      if (next >= layout.length) {
        playhead.seek(layout.length);
        playhead.setPlaying(false);
        return;
      }
      shown = next;
      playhead.seek(next);
    };
    const step = () => {
      tick();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    const timer = setInterval(tick, 100);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [playing, playhead, layout.length]);

  // Shots that matter now: the one on screen, the one fading out under it, and
  // the next one, so its first frame is ready before the cut.
  const visible = layout.shots.filter(
    (block) => block.start - 1.5 <= time && time < block.end + 0.05,
  );
  const outro = layout.outro && time >= layout.outro.start ? layout.outro : null;

  useEffect(() => {
    for (const block of visible) {
      const at = block.shot.start + (time - block.start);
      sync(media.current.get(`shot:${block.key}`) ?? null, at, playing, time >= block.start);
    }
    for (const block of layout.overlays) {
      sync(
        media.current.get(`overlay:${block.key}`) ?? null,
        time - block.start,
        playing,
        time >= block.start && time < block.end,
      );
    }
    const audio = music.current;
    if (audio) audio.volume = Math.min(1, draft.musicVolume);
    if (audio && audio.duration > 0)
      sync(audio, (time + musicStart) % audio.duration, playing, true);
    sync(narration.current, time, playing, true);
  });

  const opacity = (index: number) => {
    const block = layout.shots[index];
    if (time < block.start) return 0;
    const next = layout.shots[index + 1];
    // The incoming shot fades in over its transition; the outgoing one stays under it.
    if (index > 0 && block.shot.transition !== 'cut') {
      const before = layout.shots[index - 1];
      const overlap = clampTransition(
        block.shot.transitionSeconds,
        before.shot.duration,
        block.shot.duration,
      );
      if (overlap > 0 && time < block.start + overlap) return (time - block.start) / overlap;
    }
    return next && time >= next.start && next.shot.transition === 'cut' ? 0 : 1;
  };

  const register = (key: string) => (element: HTMLMediaElement | null) => {
    if (element) media.current.set(key, element);
    else media.current.delete(key);
  };

  return (
    <div className="space-y-1">
      <div
        className="relative overflow-hidden rounded-md bg-black"
        style={{ width, height }}
        aria-label={t('promo.timeline_preview')}
      >
        <div className="absolute inset-0" style={{ filter: LOOK_FILTER[draft.look] }}>
          {visible.map((block) => {
            const style: React.CSSProperties = {
              opacity: opacity(block.index),
              objectFit: block.shot.fit === 'cover' ? 'cover' : 'contain',
              zIndex: block.index,
            };
            const src = apiPath(block.shot.media.url);
            return block.shot.media.kind === 'image' ? (
              <img
                key={block.key}
                src={src}
                alt=""
                className="absolute inset-0 size-full"
                style={style}
              />
            ) : (
              <video
                key={block.key}
                ref={register(`shot:${block.key}`)}
                src={src}
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 size-full"
                style={style}
              />
            );
          })}
        </div>
        {layout.overlays.map((block) => (
          <video
            key={block.key}
            ref={register(`overlay:${block.key}`)}
            src={apiPath(block.overlay.media.url)}
            muted
            playsInline
            preload="auto"
            className="pointer-events-none absolute inset-0 size-full object-contain"
            style={{
              zIndex: 50,
              visibility: time >= block.start && time < block.end ? 'visible' : 'hidden',
            }}
          />
        ))}
        {draft.logo && draft.watermark !== 'none' && !outro && (
          <img
            src={apiPath(draft.logo.url)}
            alt=""
            className="pointer-events-none absolute opacity-80"
            style={{
              ...CORNER_STYLE[draft.watermark],
              zIndex: 60,
              maxWidth: '18%',
              maxHeight: '10%',
            }}
          />
        )}
        {outro && draft.logo && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              zIndex: 70,
              background: draft.outroColor,
              opacity: Math.min(1, (time - outro.start) / 0.6),
            }}
          >
            <img
              src={apiPath(draft.logo.url)}
              alt=""
              className="max-h-[30%] max-w-[50%] object-contain"
            />
          </div>
        )}
      </div>
      {draft.music && (
        <audio
          ref={music}
          src={apiPath(draft.music.url)}
          preload="auto"
          loop
          style={{ display: 'none' }}
        />
      )}
      {draft.narration && (
        <audio
          ref={narration}
          src={apiPath(draft.narration.url)}
          preload="auto"
          style={{ display: 'none' }}
        />
      )}
      <p className="text-[11px] text-muted-foreground" style={{ width }}>
        {t('promo.timeline_preview_note')}
      </p>
    </div>
  );
}
