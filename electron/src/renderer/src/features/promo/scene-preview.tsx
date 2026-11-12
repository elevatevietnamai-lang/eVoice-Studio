import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Frame attributes for a scene preview: scripts run, nothing else is allowed. */
export const SCENE_FRAME_SANDBOX = 'allow-scripts';
/** Only pages main serves on the preview scheme go into the frame. */
export const isScenePreviewUrl = (url: string) => /^promo-scene:\/\/preview\/[0-9a-f]+$/.test(url);
/** Silence after which a preview counts as stuck (a loop in the scene's script). */
export const STUCK_AFTER_MS = 3000;

/**
 * The live preview of a custom scene: the page main built, from the
 * `promo-scene:` scheme, in a frame with scripts but no origin, no popups,
 * no forms and no top navigation (see main/promo-scene-protocol.ts). The page
 * says it is alive every few hundred milliseconds; a page that stops (a
 * script stuck in a loop) is removed and reported instead of left running.
 */
export function ScenePreview({
  url,
  duration,
  width,
  height,
  boxWidth,
}: {
  url: string;
  duration: number;
  width: number;
  height: number;
  boxWidth: number;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [run, setRun] = useState(0);
  const [stuck, setStuck] = useState(false);
  const scale = boxWidth / width;

  // Loop with a short pause, so the preview never rests on the last frame.
  useEffect(() => {
    if (stuck) return;
    const timer = setInterval(() => setRun((n) => n + 1), (duration + 0.8) * 1000);
    return () => clearInterval(timer);
  }, [duration, url, stuck]);

  useEffect(() => {
    setStuck(false);
  }, [url]);

  useEffect(() => {
    if (stuck) return;
    let last = Date.now();
    const onMessage = (event: MessageEvent) => {
      // Only this frame's page, which has no origin of its own.
      if (event.source !== frame.current?.contentWindow) return;
      if ((event.data as { promoScene?: unknown })?.promoScene === 'alive') last = Date.now();
    };
    window.addEventListener('message', onMessage);
    const watchdog = setInterval(() => {
      if (Date.now() - last > STUCK_AFTER_MS) setStuck(true);
    }, 500);
    return () => {
      window.removeEventListener('message', onMessage);
      clearInterval(watchdog);
    };
  }, [run, url, stuck]);

  if (!isScenePreviewUrl(url)) return null;
  return (
    <div className="space-y-1">
      <div
        className="relative overflow-hidden rounded-sm border border-border/60"
        style={{
          width: boxWidth,
          height: Math.round(height * scale),
          // A checkerboard shows where the scene is transparent.
          background: 'repeating-conic-gradient(#3a3a3a 0 25%, #2a2a2a 0 50%) 0 0 / 16px 16px',
        }}
      >
        {stuck ? (
          <p
            role="status"
            className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-white"
          >
            {t('promo.scene_stuck')}
          </p>
        ) : (
          <iframe
            ref={frame}
            key={`${run}-${url}`}
            title={t('promo.scene_preview')}
            sandbox={SCENE_FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            src={url}
            className="pointer-events-none absolute left-0 top-0 border-0"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              colorScheme: 'normal',
            }}
          />
        )}
      </div>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setStuck(false);
          setRun((n) => n + 1);
        }}
      >
        <RotateCcwIcon />
        {t('promo.anim_replay')}
      </Button>
    </div>
  );
}
