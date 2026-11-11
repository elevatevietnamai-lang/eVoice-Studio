import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, LoaderCircleIcon, SparklesIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { PromoBrowserState } from '../../../../preload/index.d';
import { getBridge } from '@/components/bridge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_OVERLAYS,
  MAX_PROGRAM_SECONDS,
  SHAPE_SIZE,
  type PromoDraft,
  type PromoOverlay,
} from './promo-model';

/** Error codes from main/promo-ipc.ts that get their own sentence. */
const KNOWN_ERRORS = new Set([
  'local_backend_required',
  'ffmpeg_unavailable',
  'network_blocked',
  'browser_missing',
]);

let overlayCounter = 0;
const nextKey = () => `overlay-${Date.now().toString(36)}-${(overlayCounter += 1)}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const clampNumber = (value: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Number(value) || min));

export function AnimatedOverlays({
  draft,
  busy,
  onBusy,
  onAdd,
  onChange,
  onRemove,
}: {
  draft: PromoDraft;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onAdd: (overlay: PromoOverlay) => void;
  onChange: (key: string, patch: Partial<PromoOverlay>) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const bridge = getBridge();
  const [browser, setBrowser] = useState<PromoBrowserState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [glow, setGlow] = useState('#ffd400');
  const [duration, setDuration] = useState(3);
  const [start, setStart] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.promo.browserState().then((state) => live && setBrowser(state));
    const offState = bridge.promo.onBrowserState(setBrowser);
    const offProgress = bridge.promo.onRenderProgress(setProgress);
    return () => {
      live = false;
      offState();
      offProgress();
    };
  }, [bridge]);

  const shell = (children: React.ReactNode) => (
    <section className="space-y-2 rounded-(--card-radius) border border-border/60 bg-background/35 p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <SparklesIcon className="size-4" />
        {t('promo.anim_title')}
      </h2>
      {children}
    </section>
  );

  if (!bridge) {
    return shell(<p className="text-xs text-muted-foreground">{t('promo.anim_desktop_only')}</p>);
  }
  if (!browser) return null;
  if (browser.state === 'unsupported') {
    return shell(<p className="text-xs text-muted-foreground">{t('promo.anim_unsupported')}</p>);
  }

  if (browser.state !== 'ready') {
    const size = browser.state === 'installing' ? 0 : browser.downloadMegabytes;
    const percent =
      browser.state === 'installing' && browser.total > 0
        ? Math.round((browser.downloaded / browser.total) * 100)
        : 0;
    return shell(
      <>
        <p className="text-xs text-muted-foreground">{t('promo.anim_intro')}</p>
        {browser.state === 'failed' && (
          <p className="text-xs text-destructive">
            {t('promo.anim_failed', { message: browser.message })}
          </p>
        )}
        {browser.state === 'installing' ? (
          <div className="space-y-1" role="status">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('promo.anim_downloading', { percent })}
            </p>
          </div>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">{t('promo.anim_confirm', { size })}</span>
            <Button
              size="sm"
              onClick={() => {
                setConfirming(false);
                void bridge.promo.installBrowser().then(setBrowser);
              }}
            >
              <DownloadIcon />
              {t('promo.anim_download')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t('promo.anim_cancel')}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            <DownloadIcon />
            {t(browser.state === 'failed' ? 'promo.anim_retry' : 'promo.anim_enable', { size })}
          </Button>
        )}
      </>,
    );
  }

  const creating = progress !== null;
  const full = draft.overlays.length >= MAX_OVERLAYS;
  const create = async () => {
    if (busy || full || !title.trim()) return;
    setError(null);
    setProgress(0);
    onBusy(true);
    try {
      const result = await bridge.promo.renderOverlay(
        {
          template: 'glow_title',
          title: title.trim(),
          subtitle: subtitle.trim(),
          color,
          glow,
          duration,
          ...SHAPE_SIZE[draft.shape],
        },
        draft.fps,
      );
      if (result.ok) {
        onAdd({ key: nextKey(), media: result.media, start, label: title.trim() });
      } else if (result.code !== 'cancelled') {
        setError(
          KNOWN_ERRORS.has(result.code)
            ? t(`promo.anim_error_${result.code}`)
            : t('promo.anim_error_generic', { code: result.code }),
        );
      }
    } catch (cause) {
      setError(t('promo.anim_error_generic', { code: String(cause) }));
    } finally {
      setProgress(null);
      onBusy(false);
    }
  };

  return shell(
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('promo.anim_text')}>
          <Input
            value={title}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t('promo.anim_subtitle')}>
          <Input
            value={subtitle}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setSubtitle(event.target.value)}
          />
        </Field>
        <Field label={t('promo.anim_color')}>
          <Input
            type="color"
            value={color}
            disabled={busy}
            className="h-8 p-1"
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
        <Field label={t('promo.anim_glow')}>
          <Input
            type="color"
            value={glow}
            disabled={busy}
            className="h-8 p-1"
            onChange={(event) => setGlow(event.target.value)}
          />
        </Field>
        <Field label={t('promo.anim_length')}>
          <Input
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={duration}
            disabled={busy}
            onChange={(event) => setDuration(clampNumber(event.target.value, 1, 30))}
          />
        </Field>
        <Field label={t('promo.anim_start')}>
          <Input
            type="number"
            min={0}
            max={MAX_PROGRAM_SECONDS}
            step={0.1}
            value={start}
            disabled={busy}
            onChange={(event) => setStart(clampNumber(event.target.value, 0, MAX_PROGRAM_SECONDS))}
          />
        </Field>
      </div>
      {full && <p className="text-xs text-destructive">{t('promo.anim_too_many')}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || full || !title.trim()} onClick={() => void create()}>
          {creating ? (
            <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
          ) : (
            <SparklesIcon />
          )}
          {creating ? t('promo.anim_creating', { percent: progress }) : t('promo.anim_create')}
        </Button>
        {creating && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('promo.anim_cancel')}
            onClick={() => void bridge.promo.cancelRender()}
          >
            <XIcon />
            {t('promo.anim_cancel')}
          </Button>
        )}
      </div>
      {draft.overlays.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium">{t('promo.anim_overlays')}</h3>
          <ul className="space-y-1">
            {draft.overlays.map((overlay) => (
              <li key={overlay.key} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{overlay.label}</span>
                <Input
                  type="number"
                  min={0}
                  max={MAX_PROGRAM_SECONDS}
                  step={0.1}
                  value={overlay.start}
                  disabled={busy}
                  aria-label={t('promo.anim_start')}
                  className="h-7 w-20"
                  onChange={(event) =>
                    onChange(overlay.key, {
                      start: clampNumber(event.target.value, 0, MAX_PROGRAM_SECONDS),
                    })
                  }
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('promo.remove')}
                  disabled={busy}
                  onClick={() => onRemove(overlay.key)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>,
  );
}
