import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CaptionsOffIcon,
  DownloadIcon,
  EraserIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  ScanTextIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/simple-select';
import { Progress } from '@/components/ui/progress';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { consumeTaskStream } from '@/lib/api/event-stream';
import { cn } from '@/lib/utils';
import {
  type HardsubMethod,
  readDubHardsub,
  removeDubHardsub,
  restoreDubHardsub,
  syncDubHardsub,
  useDubSession,
} from './dub-session';
import { segmentedFrameClass } from '@/components/segmented';

type EngineStatus = { installed: boolean; engine?: { providers?: string[]; encoder?: string } };

const REGION_KEY = 'voicestudio.dub.hardsubRegion';

function loadRegion(): [number, number] {
  try {
    const raw = JSON.parse(localStorage.getItem(REGION_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === 2 && raw.every((v) => typeof v === 'number'))
      return [raw[0], raw[1]];
  } catch {
    // Storage can be unavailable (private window); use the default band.
  }
  return [0.72, 0.95];
}

function saveRegion(region: [number, number]) {
  try {
    localStorage.setItem(REGION_KEY, JSON.stringify(region));
  } catch {
    // Per-viewer convenience only.
  }
}

const clamp = (value: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));

/** Accelerator label for the engine status line. */
function acceleratorLabel(providers: string[] = []) {
  if (providers.includes('CUDAExecutionProvider')) return 'CUDA';
  if (providers.includes('CoreMLExecutionProvider')) return 'CoreML';
  if (providers.includes('DmlExecutionProvider')) return 'DirectML';
  return 'CPU';
}

export function HardsubPanel({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const session = useDubSession();
  const queryClient = useQueryClient();
  const jobId = session.jobId || '';
  const duration = session.duration || 0;
  const [region, setRegion] = useState<[number, number]>(
    () => (session.hardsub?.region as [number, number] | null) || loadRegion(),
  );
  const [frameAt, setFrameAt] = useState(() => Math.min(5, duration * 0.3));
  const [fps, setFps] = useState(4);
  const [method, setMethod] = useState<HardsubMethod>('lama');
  const [task, setTask] = useState<{ kind: 'install' | 'ocr' | 'clean'; progress: number } | null>(
    null,
  );
  const [installLog, setInstallLog] = useState('');
  const drag = useRef<{ startY: number; rect: DOMRect } | null>(null);
  const [open, setOpen] = useState(() => !session.hardsub?.cue_count);

  const status = useQuery({
    queryKey: ['hardsub-status'],
    queryFn: () => apiJson<EngineStatus>('/dub/hardsub/status'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (jobId) void syncDubHardsub(jobId);
  }, [jobId]);

  useEffect(() => {
    const saved = session.hardsub?.region;
    if (saved && saved.length === 2) setRegion([saved[0], saved[1]]);
  }, [session.hardsub?.region]);

  const updateRegion = useCallback((next: [number, number]) => {
    const top = clamp(Math.min(next[0], next[1]));
    const bottom = clamp(Math.max(next[0], next[1]));
    const fixed: [number, number] = [top, Math.max(bottom, Math.min(1, top + 0.03))];
    setRegion(fixed);
    saveRegion(fixed);
  }, []);

  const frameUrl = jobId
    ? apiPath(`/dub/hardsub/frame/${encodeURIComponent(jobId)}?t=${frameAt.toFixed(2)}&width=960`)
    : '';

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (busy || task) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = clamp((event.clientY - rect.top) / rect.height);
    drag.current = { startY: y, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateRegion([y, y + 0.03]);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { startY, rect } = drag.current;
    updateRegion([startY, clamp((event.clientY - rect.top) / rect.height)]);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const install = async () => {
    setTask({ kind: 'install', progress: 0 });
    setInstallLog('');
    try {
      await consumeTaskStream('/dub/hardsub/install-stream', (event) => {
        if (event.type === 'progress')
          setTask({ kind: 'install', progress: Number(event.progress) || 0 });
        if (event.type === 'log') setInstallLog(String(event.message || ''));
        if (event.type === 'error') throw new Error(String(event.reason || 'Install failed'));
        return event.type === 'done';
      });
      await queryClient.invalidateQueries({ queryKey: ['hardsub-status'] });
      toast.success(t('dub_hardsub.installed'));
    } catch (error) {
      toast.error(t('dub_hardsub.install_failed', { message: describeError(error) }));
    } finally {
      setTask(null);
    }
  };

  const readSubtitles = async () => {
    setTask({ kind: 'ocr', progress: 0 });
    const ok = await readDubHardsub({ top: region[0], bottom: region[1], fps }, (progress) =>
      setTask({ kind: 'ocr', progress }),
    );
    setTask(null);
    if (ok) toast.success(t('dub_hardsub.read_done'));
  };

  const removeSubtitles = async () => {
    setTask({ kind: 'clean', progress: 0 });
    const ok = await removeDubHardsub(method, (progress) => setTask({ kind: 'clean', progress }));
    setTask(null);
    if (ok) toast.success(t('dub_hardsub.remove_done'));
  };

  const restore = async () => {
    try {
      await restoreDubHardsub();
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  if (session.inputType !== 'video' || !jobId) return null;
  const installed = Boolean(status.data?.installed);
  const hs = session.hardsub;
  const locked = busy || Boolean(task) || Boolean(session.recovery);

  return (
    <details
      className="group rounded-lg border border-border/60 bg-background/35 p-2.5"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
        <ScanTextIcon className="size-3.5 text-primary" />
        <span className="mr-auto">{t('dub_hardsub.title')}</span>
        {hs?.cleaned ? (
          <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
            {t('dub_hardsub.badge_cleaned')}
          </span>
        ) : hs?.cue_count ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-primary">
            {t('dub_hardsub.badge_read', { count: hs.cue_count })}
          </span>
        ) : null}
      </summary>

      <div className="mt-2.5 space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('dub_hardsub.help')}</p>

        {!installed ? (
          <div className="space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">
              {t('dub_hardsub.install_help')}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={locked || status.isLoading}
              onClick={install}
            >
              {task?.kind === 'install' ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <DownloadIcon />
              )}
              {t('dub_hardsub.install')}
            </Button>
            {task?.kind === 'install' && (
              <div className="space-y-1">
                <Progress
                  value={Math.round(task.progress * 100)}
                  aria-label={t('dub_hardsub.install')}
                />
                {installLog && (
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {installLog}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{t('dub_hardsub.region')}</span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(region[0] * 100)}% – {Math.round(region[1] * 100)}%
                </span>
              </div>
              <div
                role="slider"
                aria-label={t('dub_hardsub.region')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(region[0] * 100)}
                tabIndex={0}
                className={cn(
                  'relative overflow-hidden rounded-lg border border-border/60 bg-black select-none',
                  locked ? 'cursor-not-allowed opacity-70' : 'cursor-crosshair',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(event) => {
                  if (locked) return;
                  const step = event.shiftKey ? 0.05 : 0.01;
                  if (event.key === 'ArrowUp') updateRegion([region[0] - step, region[1] - step]);
                  else if (event.key === 'ArrowDown')
                    updateRegion([region[0] + step, region[1] + step]);
                  else return;
                  event.preventDefault();
                }}
              >
                <img
                  key={frameUrl}
                  src={frameUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none block w-full"
                />
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 bg-black/45"
                  style={{ height: `${region[0] * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45"
                  style={{ height: `${(1 - region[1]) * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 border-y-2 border-amber-400"
                  style={{
                    top: `${region[0] * 100}%`,
                    height: `${(region[1] - region[0]) * 100}%`,
                  }}
                />
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t('dub_hardsub.region_help')}
              </p>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="shrink-0">{t('dub_hardsub.frame_at')}</span>
                <input
                  type="range"
                  className="min-w-0 flex-1 accent-primary"
                  min={0}
                  max={Math.max(0.1, duration)}
                  step={0.1}
                  value={frameAt}
                  disabled={locked}
                  onChange={(event) => setFrameAt(Number(event.target.value))}
                />
                <span className="w-10 text-right tabular-nums">{frameAt.toFixed(1)}s</span>
              </label>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
                  <span>{t('dub_hardsub.top_edge')}</span>
                  <input
                    type="range"
                    className="w-full accent-primary"
                    min={0}
                    max={100}
                    value={Math.round(region[0] * 100)}
                    disabled={locked}
                    onChange={(event) =>
                      updateRegion([Number(event.target.value) / 100, region[1]])
                    }
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
                  <span>{t('dub_hardsub.bottom_edge')}</span>
                  <input
                    type="range"
                    className="w-full accent-primary"
                    min={0}
                    max={100}
                    value={Math.round(region[1] * 100)}
                    disabled={locked}
                    onChange={(event) =>
                      updateRegion([region[0], Number(event.target.value) / 100])
                    }
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2 border-t border-border/50 pt-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>{t('dub_hardsub.scan_rate')}</span>
                <SimpleSelect
                  label={t('dub_hardsub.scan_rate')}
                  value={String(fps)}
                  items={[2, 4, 6, 8].map((value) => ({
                    value: String(value),
                    label: t('dub_hardsub.scan_rate_value', { count: value }),
                  }))}
                  disabled={locked}
                  onValueChange={(value) => setFps(Number(value))}
                />
              </div>
              <Button className="w-full" size="sm" disabled={locked} onClick={readSubtitles}>
                {task?.kind === 'ocr' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <ScanTextIcon />
                )}
                {hs?.cue_count ? t('dub_hardsub.read_again') : t('dub_hardsub.read')}
              </Button>
              {task?.kind === 'ocr' && (
                <Progress
                  value={Math.round(task.progress * 100)}
                  aria-label={t('dub_hardsub.read')}
                />
              )}
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t('dub_hardsub.read_help')}
              </p>
            </div>

            <div className="space-y-2 border-t border-border/50 pt-3">
              <div className={cn(segmentedFrameClass, 'grid grid-cols-3')}>
                {(['sttn', 'lama', 'propainter'] as const).map((value) => (
                  <Button
                    key={value}
                    size="xs"
                    variant={method === value ? 'secondary' : 'ghost'}
                    aria-pressed={method === value}
                    disabled={locked}
                    onClick={() => setMethod(value)}
                  >
                    {t(`dub_hardsub.method_${value}`)}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t(`dub_hardsub.method_${method}_help`)}
              </p>
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                disabled={locked || !hs?.cue_count}
                onClick={removeSubtitles}
              >
                {task?.kind === 'clean' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <EraserIcon />
                )}
                {hs?.cleaned ? t('dub_hardsub.remove_again') : t('dub_hardsub.remove')}
              </Button>
              {task?.kind === 'clean' && (
                <Progress
                  value={Math.round(task.progress * 100)}
                  aria-label={t('dub_hardsub.remove')}
                />
              )}
              {!hs?.cue_count && (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {t('dub_hardsub.remove_needs_read')}
                </p>
              )}
              {hs?.cleaned && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="w-full"
                  disabled={locked}
                  onClick={restore}
                >
                  <RotateCcwIcon />
                  {t('dub_hardsub.restore')}
                </Button>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CaptionsOffIcon className="size-3" />
              {t('dub_hardsub.engine_line', {
                accel: acceleratorLabel(status.data?.engine?.providers),
              })}
            </p>
          </>
        )}
      </div>
    </details>
  );
}
