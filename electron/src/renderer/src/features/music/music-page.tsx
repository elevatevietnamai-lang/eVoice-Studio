import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DownloadIcon,
  LoaderCircleIcon,
  MusicIcon,
  PowerOffIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBridge } from '@/components/bridge';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { SecondarySidebar } from '@/components/workspace-sidebar';
import { WaveformPlayer } from '@/components/waveform-player';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { consumeTaskStream } from '@/lib/api/event-stream';
import { saveExport } from '@/lib/export-history';

type MusicStatus = { installed: boolean; running: boolean };
type Track = {
  id: string;
  title: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number;
  bpm: number | null;
  created_at: number;
};

const STYLE_PRESETS = [
  'calm lo-fi, soft piano, 85 bpm',
  'upbeat pop, bright synth, 120 bpm',
  'cinematic ambient, warm strings',
  'energetic electronic, punchy drums, 128 bpm',
  'acoustic guitar, cozy, 95 bpm',
];

const fieldClass =
  'h-8 w-full rounded-md border border-input bg-background/40 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function MusicPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(STYLE_PRESETS[0]);
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(true);
  const [duration, setDuration] = useState(60);
  const [bpm, setBpm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<{ kind: 'install' | 'generate'; progress: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const status = useQuery({
    queryKey: ['music-status'],
    queryFn: () => apiJson<MusicStatus>('/music/status'),
    refetchInterval: 10_000,
  });
  const library = useQuery({
    queryKey: ['music-library'],
    queryFn: () => apiJson<{ tracks: Track[] }>('/music/library'),
  });
  const tracks = library.data?.tracks ?? [];
  const selected = tracks.find((track) => track.id === selectedId) ?? tracks[0] ?? null;
  const installed = Boolean(status.data?.installed);
  const busy = Boolean(task);

  const install = async () => {
    setTask({ kind: 'install', progress: 0 });
    try {
      await consumeTaskStream('/music/install-stream', (event) => {
        if (event.type === 'progress')
          setTask({ kind: 'install', progress: Number(event.progress) || 0 });
        if (event.type === 'error') throw new Error(String(event.reason || 'Install failed'));
        return event.type === 'done';
      });
      toast.success(t('musicStudio.engine_installed'));
    } catch (error) {
      toast.error(t('musicStudio.engine_install_failed', { message: describeError(error) }));
    } finally {
      setTask(null);
      void queryClient.invalidateQueries({ queryKey: ['music-status'] });
    }
  };

  const generate = async () => {
    abort.current = new AbortController();
    setTask({ kind: 'generate', progress: 0 });
    try {
      const body = {
        prompt,
        lyrics: instrumental ? '' : lyrics,
        instrumental,
        duration,
        bpm: bpm ? Number(bpm) : null,
      };
      await consumeTaskStream(
        '/music/generate',
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'generate', progress: Number(event.progress) || 0 });
          if (event.type === 'error') throw new Error(String(event.reason || 'Music failed'));
          if (event.type === 'done') {
            const track = event.track as Track | undefined;
            if (track?.id) setSelectedId(track.id);
          }
          return event.type === 'done';
        },
        abort.current.signal,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      toast.success(t('musicStudio.generated'));
      await queryClient.invalidateQueries({ queryKey: ['music-library'] });
    } catch (error) {
      if (!abort.current?.signal.aborted) toast.error(describeError(error));
    } finally {
      abort.current = null;
      setTask(null);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiJson(`/music/library/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['music-library'] }),
    onError: (error) =>
      toast.error(t('musicStudio.delete_failed', { message: describeError(error) })),
  });

  const stopEngine = useMutation({
    mutationFn: () => apiJson('/music/stop', { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('musicStudio.engine_stopped'));
      void queryClient.invalidateQueries({ queryKey: ['music-status'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const download = async (track: Track) => {
    const url = apiPath(`/music/audio/${encodeURIComponent(track.id)}`);
    const name = `${track.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'music'}.wav`;
    try {
      if (getBridge()) await saveExport(url, name);
      else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
      }
    } catch (error) {
      toast.error(describeError(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">{t('musicStudio.title')}</h1>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1 @max-[40rem]:flex-col">
        <SecondarySidebar
          title={t('musicStudio.title')}
          icon={MusicIcon}
          size="wide"
          variant="controls"
          className="space-y-3"
        >
          {!installed ? (
            <section className="space-y-2 rounded-xl border border-border/60 bg-muted/15 p-3">
              <h2 className="text-sm font-medium">{t('musicStudio.engine_title')}</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                {t('musicStudio.engine_help')}
              </p>
              <Button className="w-full" size="sm" disabled={busy} onClick={install}>
                {task?.kind === 'install' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon />
                )}
                {task?.kind === 'install'
                  ? t('musicStudio.engine_installing')
                  : t('musicStudio.engine_install')}
              </Button>
              {task?.kind === 'install' && (
                <Progress
                  value={Math.round(task.progress * 100)}
                  aria-label={t('musicStudio.engine_installing')}
                />
              )}
            </section>
          ) : null}

          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">{t('musicStudio.prompt')}</span>
            <Textarea
              value={prompt}
              maxLength={1000}
              rows={3}
              disabled={busy}
              placeholder={t('musicStudio.prompt_placeholder')}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {STYLE_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="xs"
                variant={prompt === preset ? 'secondary' : 'ghost'}
                disabled={busy}
                onClick={() => setPrompt(preset)}
              >
                {preset.split(',')[0]}
              </Button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{t('musicStudio.instrumental')}</span>
            <Switch checked={instrumental} disabled={busy} onCheckedChange={setInstrumental} />
          </label>
          {!instrumental && (
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium">{t('musicStudio.lyrics')}</span>
              <Textarea
                value={lyrics}
                maxLength={8000}
                rows={6}
                disabled={busy}
                placeholder={t('musicStudio.lyrics_placeholder')}
                onChange={(event) => setLyrics(event.target.value)}
              />
            </label>
          )}

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('musicStudio.duration')}</span>
              <span className="text-muted-foreground">
                {t('musicStudio.duration_value', { seconds: duration })}
              </span>
            </div>
            <Slider
              min={10}
              max={240}
              step={5}
              value={[duration]}
              disabled={busy}
              aria-label={t('musicStudio.duration')}
              onValueChange={(value) => setDuration(Array.isArray(value) ? value[0] : value)}
            />
          </div>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">{t('musicStudio.bpm')}</span>
            <input
              className={fieldClass}
              inputMode="numeric"
              value={bpm}
              disabled={busy}
              placeholder={t('musicStudio.bpm_hint')}
              onChange={(event) => setBpm(event.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </label>

          <Button
            className="w-full"
            size="sm"
            disabled={busy || !installed || !prompt.trim()}
            onClick={generate}
          >
            {task?.kind === 'generate' ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <SparklesIcon />
            )}
            {task?.kind === 'generate' ? t('musicStudio.generating') : t('musicStudio.generate')}
          </Button>
          {task?.kind === 'generate' && (
            <Progress
              value={Math.round(task.progress * 100)}
              aria-label={t('musicStudio.generating')}
            />
          )}
          {installed && status.data?.running && (
            <Button
              className="w-full"
              size="xs"
              variant="ghost"
              disabled={busy || stopEngine.isPending}
              onClick={() => stopEngine.mutate()}
            >
              <PowerOffIcon />
              {t('musicStudio.free_memory')}
            </Button>
          )}
          <p className="text-[11px] leading-4 text-muted-foreground">{t('musicStudio.credit')}</p>
        </SecondarySidebar>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {selected && (
            <section className="space-y-2 rounded-xl border border-border/60 bg-muted/15 p-3">
              <h2 className="truncate text-sm font-medium">{selected.title}</h2>
              <WaveformPlayer
                key={selected.id}
                src={apiPath(`/music/audio/${encodeURIComponent(selected.id)}`)}
                showWaveform
                height={64}
              />
            </section>
          )}
          <section className="space-y-2">
            <h2 className="text-sm font-medium">{t('musicStudio.library')}</h2>
            {tracks.length === 0 ? (
              <p
                role="status"
                className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground"
              >
                {t('musicStudio.empty')}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {tracks.map((track) => (
                  <li
                    key={track.id}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/35 px-2.5 py-2"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={selected?.id === track.id}
                      onClick={() => setSelectedId(track.id)}
                    >
                      <span className="block truncate text-sm font-medium">{track.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {t('musicStudio.duration_value', { seconds: track.duration })}
                        {track.instrumental ? ` · ${t('musicStudio.instrumental')}` : ''}
                        {' · '}
                        {new Date(track.created_at * 1000).toLocaleString()}
                      </span>
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('musicStudio.download')}
                      onClick={() => download(track)}
                    >
                      <DownloadIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('musicStudio.delete')}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(track.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
