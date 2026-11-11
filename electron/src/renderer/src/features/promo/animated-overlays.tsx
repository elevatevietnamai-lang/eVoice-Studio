import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DownloadIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { PromoBrowserState, PromoOverlayInput } from '../../../../preload/index.d';
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

type TemplateId = PromoOverlayInput['template'];

/** Mirrors TEMPLATE_SPECS in main/promo-templates.ts, plus starting colours. */
export const TEMPLATES: readonly {
  id: TemplateId;
  lines: boolean;
  logo: boolean;
  color: string;
  accent: string;
}[] = [
  { id: 'glow_title', lines: false, logo: false, color: '#ffffff', accent: '#ffd400' },
  { id: 'handwriting', lines: false, logo: false, color: '#ffffff', accent: '#ffd400' },
  { id: 'search_bar', lines: false, logo: false, color: '#202124', accent: '#1a73e8' },
  { id: 'contact_card', lines: true, logo: false, color: '#ffffff', accent: '#ffb000' },
  { id: 'logo_reveal', lines: false, logo: true, color: '#ffffff', accent: '#ffd400' },
];
const LINE_COUNT = 3;

/** Error codes from main/promo-ipc.ts that get their own sentence. */
const KNOWN_ERRORS = new Set([
  'local_backend_required',
  'ffmpeg_unavailable',
  'network_blocked',
  'browser_missing',
  'logo_missing',
  'logo_too_large',
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

/** Width of the preview box; the page is scaled down to fit it. */
const PREVIEW_WIDTH = { vertical: 180, square: 260, landscape: 320 } as const;

/**
 * Live preview: the template page in a sandboxed frame with no scripts and
 * no origin. Fonts and logo are inlined by main, so it needs nothing else.
 */
function TemplatePreview({
  html,
  duration,
  width,
  height,
  boxWidth,
}: {
  html: string;
  duration: number;
  width: number;
  height: number;
  boxWidth: number;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState(0);
  const scale = boxWidth / width;
  // Loop with a short pause, so the preview never rests on the faded end.
  useEffect(() => {
    const timer = setInterval(() => setRun((n) => n + 1), (duration + 0.8) * 1000);
    return () => clearInterval(timer);
  }, [duration, html]);
  return (
    <div className="space-y-1">
      <div
        className="relative overflow-hidden rounded-md border border-border/60"
        style={{
          width: boxWidth,
          height: Math.round(height * scale),
          // A checkerboard shows where the overlay is transparent.
          background: 'repeating-conic-gradient(#3a3a3a 0 25%, #2a2a2a 0 50%) 0 0 / 16px 16px',
        }}
      >
        <iframe
          key={`${run}-${html.length}`}
          title={t('promo.anim_preview')}
          sandbox=""
          srcDoc={html}
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            // Chromium paints a frame opaque when its colour scheme differs
            // from the page's; the template page uses the default scheme.
            colorScheme: 'normal',
          }}
        />
      </div>
      <Button size="xs" variant="ghost" onClick={() => setRun((n) => n + 1)}>
        <RotateCcwIcon />
        {t('promo.anim_replay')}
      </Button>
    </div>
  );
}

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
  const [template, setTemplate] = useState<TemplateId>('glow_title');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [lines, setLines] = useState<string[]>(['', '', '']);
  const [color, setColor] = useState('#ffffff');
  const [glow, setGlow] = useState('#ffd400');
  const [duration, setDuration] = useState(3);
  const [start, setStart] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const spec = TEMPLATES.find((item) => item.id === template)!;
  const size = SHAPE_SIZE[draft.shape];
  const logoId = spec.logo ? draft.logo?.id : undefined;
  const ready = spec.logo ? !!logoId : !!title.trim();

  const input = useMemo<PromoOverlayInput>(
    () => ({
      template,
      title: title.trim(),
      subtitle: subtitle.trim(),
      ...(spec.lines ? { lines: lines.map((line) => line.trim()).filter(Boolean) } : {}),
      ...(logoId ? { logoId } : {}),
      color,
      glow,
      duration,
      ...size,
    }),
    [template, title, subtitle, lines, logoId, color, glow, duration, size, spec.lines],
  );

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

  // The preview runs in this window, so it works before Chrome is downloaded.
  useEffect(() => {
    if (!bridge || !ready) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void bridge.promo.previewTemplate(input).then((result) => {
        if (live) setPreview(result.ok ? result.html : null);
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bridge, input, ready]);

  const shell = (children: React.ReactNode) => (
    <section className="space-y-3 rounded-(--card-radius) border border-border/60 bg-background/35 p-3">
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

  const pick = (id: TemplateId) => {
    const next = TEMPLATES.find((item) => item.id === id)!;
    setTemplate(id);
    setColor(next.color);
    setGlow(next.accent);
    setError(null);
  };

  const creating = progress !== null;
  const full = draft.overlays.length >= MAX_OVERLAYS;
  const create = async () => {
    if (busy || full || !ready) return;
    setError(null);
    setProgress(0);
    onBusy(true);
    try {
      const result = await bridge.promo.renderOverlay(input, draft.fps);
      if (result.ok) {
        onAdd({
          key: nextKey(),
          media: result.media,
          start,
          label: input.title || t(`promo.anim_template_${template}`),
        });
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

  const download = () => {
    if (browser.state === 'ready') return null;
    if (browser.state === 'installing') {
      const percent =
        browser.total > 0 ? Math.round((browser.downloaded / browser.total) * 100) : 0;
      return (
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
      );
    }
    const mb = browser.downloadMegabytes;
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('promo.anim_intro')}</p>
        {browser.state === 'failed' && (
          <p className="text-xs text-destructive">
            {t('promo.anim_failed', { message: browser.message })}
          </p>
        )}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">{t('promo.anim_confirm', { size: mb })}</span>
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
            {t(browser.state === 'failed' ? 'promo.anim_retry' : 'promo.anim_enable', { size: mb })}
          </Button>
        )}
      </div>
    );
  };

  return shell(
    <>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('promo.anim_template')}>
        {TEMPLATES.map((item) => (
          <Button
            key={item.id}
            size="xs"
            aria-pressed={template === item.id}
            variant={template === item.id ? 'secondary' : 'ghost'}
            disabled={busy}
            onClick={() => pick(item.id)}
          >
            {t(`promo.anim_template_${item.id}`)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid min-w-[16rem] flex-1 grid-cols-2 gap-2">
          <Field label={t(`promo.anim_text_${template}`)}>
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
          {spec.lines &&
            Array.from({ length: LINE_COUNT }, (_, index) => (
              <Field key={index} label={t('promo.anim_line', { number: index + 1 })}>
                <Input
                  value={lines[index]}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((line, at) => (at === index ? event.target.value : line)),
                    )
                  }
                />
              </Field>
            ))}
          <Field label={t('promo.anim_color')}>
            <Input
              type="color"
              value={color}
              disabled={busy}
              className="h-8 p-1"
              onChange={(event) => setColor(event.target.value)}
            />
          </Field>
          <Field label={t('promo.anim_accent')}>
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
              onChange={(event) =>
                setStart(clampNumber(event.target.value, 0, MAX_PROGRAM_SECONDS))
              }
            />
          </Field>
          {spec.logo && !draft.logo && (
            <p className="col-span-2 text-xs text-muted-foreground">
              {t('promo.anim_logo_needed')}
            </p>
          )}
        </div>
        {preview && (
          <TemplatePreview
            html={preview}
            duration={duration}
            width={size.width}
            height={size.height}
            boxWidth={PREVIEW_WIDTH[draft.shape]}
          />
        )}
      </div>
      {download()}
      {full && <p className="text-xs text-destructive">{t('promo.anim_too_many')}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {browser.state === 'ready' && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy || full || !ready} onClick={() => void create()}>
            {creating ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <SparklesIcon />
            )}
            {creating ? t('promo.anim_creating', { percent: progress }) : t('promo.anim_create')}
          </Button>
          {creating && (
            <Button size="sm" variant="ghost" onClick={() => void bridge.promo.cancelRender()}>
              <XIcon />
              {t('promo.anim_cancel')}
            </Button>
          )}
        </div>
      )}
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
