import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DownloadIcon, LoaderCircleIcon, MusicIcon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getBridge } from '@/components/bridge';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { consumeTaskStream } from '@/lib/api/event-stream';
import { saveExport } from '@/lib/export-history';
import type { DubSession } from './dub-session';

type MusicStatus = { installed: boolean; running: boolean; model_ready: boolean };
type MusicState = { has_track: boolean; style?: string | null; revision: number };

const STYLE_PRESETS = [
  'calm lo-fi, soft piano, 85 bpm',
  'upbeat pop, bright synth, 120 bpm',
  'cinematic ambient, warm strings',
  'energetic electronic, punchy drums, 128 bpm',
  'acoustic guitar, cozy, 95 bpm',
];

export function BgmPanel({ session, disabled }: { session: DubSession; disabled: boolean }) {
  const { t } = useTranslation();
  const jobId = session.jobId || '';
  const [style, setStyle] = useState(STYLE_PRESETS[0]);
  const [gain, setGain] = useState(0.35);
  const [burn, setBurn] = useState(true);
  const [lang, setLang] = useState(session.tracks[0] || '');
  const [task, setTask] = useState<{ kind: 'gen' | 'export'; progress: number } | null>(null);
  const [state, setState] = useState<MusicState>({ has_track: false, revision: 0 });

  const status = useQuery({
    queryKey: ['bgm-status'],
    queryFn: () => apiJson<MusicStatus>('/dub/bgm/status'),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!jobId) return;
    apiJson<MusicState>(`/dub/bgm/state/${encodeURIComponent(jobId)}`)
      .then((next) => {
        setState(next);
        if (next.style) setStyle(next.style);
      })
      .catch(() => undefined);
  }, [jobId]);

  useEffect(() => {
    if (!lang || !session.tracks.includes(lang)) setLang(session.tracks[0] || '');
  }, [lang, session.tracks]);

  if (session.inputType !== 'video' || !jobId) return null;
  const running = Boolean(status.data?.installed);
  const locked = disabled || Boolean(task);

  const generate = async () => {
    setTask({ kind: 'gen', progress: 0 });
    try {
      const query = new URLSearchParams({ style });
      await consumeTaskStream(
        `/dub/bgm/generate-stream/${encodeURIComponent(jobId)}?${query}`,
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'gen', progress: Number(event.progress) || 0 });
          if (event.type === 'error') throw new Error(String(event.reason || 'Music failed'));
          if (event.type === 'done')
            setState((prev) => ({
              has_track: true,
              style,
              revision: Number(event.revision) || prev.revision + 1,
            }));
          return event.type === 'done';
        },
      );
      toast.success(t('dub_bgm.generated'));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setTask(null);
    }
  };

  const exportVideo = async () => {
    if (!lang) return;
    setTask({ kind: 'export', progress: 0 });
    try {
      let file = '';
      const query = new URLSearchParams({
        lang,
        music_gain: gain.toFixed(2),
        burn: String(burn),
      });
      await consumeTaskStream(
        `/dub/bgm/export-stream/${encodeURIComponent(jobId)}?${query}`,
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'export', progress: Number(event.progress) || 0 });
          if (event.type === 'error') throw new Error(String(event.reason || 'Export failed'));
          if (event.type === 'done') file = String(event.file || '');
          return event.type === 'done';
        },
      );
      if (!file) throw new Error('Export finished without a file');
      const url = apiPath(
        `/dub/bgm/download/${encodeURIComponent(jobId)}?file=${encodeURIComponent(file)}`,
      );
      const name = `${(session.filename || 'video').replace(/\.[^.]+$/, '')}_${lang}_music.mp4`;
      if (getBridge()) await saveExport(url, name);
      else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
      }
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setTask(null);
    }
  };

  return (
    <details className="group rounded-xl border border-border/60 bg-muted/15 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <MusicIcon className="size-4 text-muted-foreground" />
        <span className="mr-auto">{t('dub_bgm.title')}</span>
        {state.has_track && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {t('dub_bgm.badge_ready')}
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('dub_bgm.help')}</p>
        {!running ? (
          <p
            role="status"
            className="rounded-lg border border-border/60 bg-background/35 px-2.5 py-2 text-xs leading-5 text-muted-foreground"
          >
            {t('dub_bgm.not_running')}
          </p>
        ) : (
          <>
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium">{t('dub_bgm.style')}</span>
              <input
                className="h-8 w-full rounded-md border border-input bg-background/40 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                value={style}
                maxLength={400}
                disabled={locked}
                onChange={(event) => setStyle(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {STYLE_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="xs"
                  variant={style === preset ? 'secondary' : 'ghost'}
                  disabled={locked}
                  onClick={() => setStyle(preset)}
                >
                  {preset.split(',')[0]}
                </Button>
              ))}
            </div>
            <Button className="w-full" size="sm" disabled={locked} onClick={generate}>
              {task?.kind === 'gen' ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <SparklesIcon />
              )}
              {state.has_track ? t('dub_bgm.regenerate') : t('dub_bgm.generate')}
            </Button>
            {task?.kind === 'gen' && (
              <Progress value={Math.round(task.progress * 100)} aria-label={t('dub_bgm.generate')} />
            )}
            {state.has_track && (
              <audio
                key={state.revision}
                controls
                className="w-full"
                src={apiPath(`/dub/bgm/preview/${encodeURIComponent(jobId)}?v=${state.revision}`)}
              />
            )}
            <div className="space-y-2 border-t border-border/50 pt-3">
              <label className="flex items-center gap-2 text-xs">
                <span className="shrink-0">{t('dub_bgm.volume')}</span>
                <input
                  type="range"
                  className="min-w-0 flex-1 accent-primary"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gain}
                  disabled={locked}
                  onChange={(event) => setGain(Number(event.target.value))}
                />
                <span className="w-9 text-right tabular-nums">{Math.round(gain * 100)}%</span>
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>{t('dub_bgm.track')}</span>
                <select
                  className="h-7 rounded-md border border-border/60 bg-background px-2 text-xs"
                  value={lang}
                  disabled={locked || session.tracks.length === 0}
                  onChange={(event) => setLang(event.target.value)}
                >
                  {session.tracks.map((track) => (
                    <option key={track} value={track}>
                      {track}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={burn}
                  disabled={locked}
                  onChange={(event) => setBurn(event.target.checked)}
                />
                {t('dub_bgm.burn')}
              </label>
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                disabled={locked || !state.has_track || !lang}
                onClick={exportVideo}
              >
                {task?.kind === 'export' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon />
                )}
                {t('dub_bgm.export')}
              </Button>
              {task?.kind === 'export' && (
                <Progress value={Math.round(task.progress * 100)} aria-label={t('dub_bgm.export')} />
              )}
              {session.tracks.length === 0 && (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {t('dub_bgm.needs_dub')}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
