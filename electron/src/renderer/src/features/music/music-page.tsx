import { useRef, useState } from 'react';
import { Reveal } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BrainIcon,
  ChevronDownIcon,
  DicesIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MusicIcon,
  PowerOffIcon,
  RotateCcwIcon,
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
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { consumeTaskStream } from '@/lib/api/event-stream';
import { gpuBusyMessage } from '@/lib/api/failure';
import { saveExport } from '@/lib/export-history';
import { formatBytes } from '@/lib/format-bytes';
import {
  KEY_NOTES,
  TIME_SIGNATURES,
  defaultVocalLanguage,
  meterLabel,
  randomSeed,
  vocalLanguageOptions,
} from './music-options';

type MusicStatus = { installed: boolean; running: boolean };
/** Which language model Thinking uses on this GPU (`GET /music/lm`). */
type LmStatus = { model: string | null; ready: boolean; download_bytes: number };
type Track = {
  id: string;
  title: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number;
  bpm: number | null;
  created_at: number;
  // Tracks saved before these fields existed have none of them.
  seed?: number | null;
  key_scale?: string;
  time_signature?: string;
  thinking?: boolean;
};

const STYLE_PRESETS = [
  'calm lo-fi, soft piano, 85 bpm',
  'upbeat pop, bright synth, 120 bpm',
  'cinematic ambient, warm strings',
  'energetic electronic, punchy drums, 128 bpm',
  'acoustic guitar, cozy, 95 bpm',
];

interface InstallStep {
  stage: 'source' | 'engine' | 'model';
  bytes: number;
  total: number | null;
  log: string;
}

/** The install's long steps report bytes on disk; the Python environment has no known total. */
/** Short amount for the install button: done of total when the step knows its size. */
export function installAmount(step: InstallStep | null): string | null {
  if (!step || step.stage === 'source') return null;
  if (step.total) return `${formatBytes(step.bytes)} / ${formatBytes(step.total)}`;
  return step.bytes > 0 ? formatBytes(step.bytes) : null;
}

function installStepLabel(step: InstallStep) {
  if (step.stage === 'source') return { key: 'musicStudio.install_step_source', values: {} };
  if (step.stage === 'engine')
    return {
      key: 'musicStudio.install_step_engine',
      // While the torch wheel downloads the step knows its size; uv's own downloads do not.
      values: { amount: installAmount(step) ?? formatBytes(step.bytes) },
    };
  return {
    key: 'musicStudio.install_step_model',
    values: { done: formatBytes(step.bytes), total: formatBytes(step.total ?? 0) },
  };
}

export function MusicPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(STYLE_PRESETS[0]);
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(true);
  const [duration, setDuration] = useState(60);
  const [bpm, setBpm] = useState('');
  const [vocalLanguage, setVocalLanguage] = useState(() => defaultVocalLanguage(i18n.language));
  const [keyScale, setKeyScale] = useState('');
  const [timeSignature, setTimeSignature] = useState('');
  const [seed, setSeed] = useState('');
  const [thinking, setThinking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<{
    kind: 'install' | 'generate' | 'lm';
    progress: number;
  } | null>(null);
  const [installStep, setInstallStep] = useState<InstallStep | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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
  // Measuring the GPU starts the engine's Python once, so it runs only after install.
  const lm = useQuery({
    queryKey: ['music-lm'],
    queryFn: () => apiJson<LmStatus>('/music/lm'),
    enabled: installed,
    staleTime: Infinity,
  });
  const lmModel = lm.data?.model ?? null;
  const lmReady = Boolean(lm.data?.ready);
  const languages = vocalLanguageOptions(i18n.language);
  const keyLabel = (value: string) => {
    const [note, mode] = value.split(' ');
    return mode === 'minor'
      ? t('musicStudio.key_minor', { note })
      : t('musicStudio.key_major', { note });
  };
  const keyChoices = KEY_NOTES.flatMap((note) => [`${note} major`, `${note} minor`]);

  const downloadLm = async () => {
    setTask({ kind: 'lm', progress: 0 });
    try {
      await consumeTaskStream('/music/lm-install-stream', (event) => {
        if (event.type === 'progress')
          setTask({ kind: 'lm', progress: Number(event.progress) || 0 });
        if (event.type === 'error') throw new Error(String(event.reason || 'Download failed'));
        return event.type === 'done';
      });
      setThinking(true);
    } catch (error) {
      toast.error(t('musicStudio.thinking_download_failed', { message: describeError(error) }));
    } finally {
      setTask(null);
      void queryClient.invalidateQueries({ queryKey: ['music-lm'] });
    }
  };

  const install = async () => {
    setTask({ kind: 'install', progress: 0 });
    setInstallStep(null);
    try {
      await consumeTaskStream('/music/install-stream', (event) => {
        if (event.type === 'progress') {
          setTask({ kind: 'install', progress: Number(event.progress) || 0 });
          const stage = event.stage;
          if (stage === 'source' || stage === 'engine' || stage === 'model')
            setInstallStep((step) => ({
              stage,
              bytes: Number(event.bytes) || 0,
              total: Number(event.total) || null,
              log: step?.stage === stage ? step.log : '',
            }));
        }
        if (event.type === 'log')
          setInstallStep((step) => (step ? { ...step, log: String(event.message || '') } : step));
        if (event.type === 'error') throw new Error(String(event.reason || 'Install failed'));
        return event.type === 'done';
      });
      toast.success(t('musicStudio.engine_installed'));
    } catch (error) {
      toast.error(t('musicStudio.engine_install_failed', { message: describeError(error) }));
    } finally {
      setTask(null);
      setInstallStep(null);
      void queryClient.invalidateQueries({ queryKey: ['music-status'] });
    }
  };

  const generate = async () => {
    abort.current = new AbortController();
    setFailure(null);
    setTask({ kind: 'generate', progress: 0 });
    try {
      const body = {
        prompt,
        lyrics: instrumental ? '' : lyrics,
        instrumental,
        duration,
        bpm: bpm ? Number(bpm) : null,
        vocal_language: instrumental ? 'en' : vocalLanguage,
        key_scale: keyScale,
        time_signature: timeSignature,
        seed: seed ? Number(seed) : null,
        thinking: thinking && lmReady,
      };
      await consumeTaskStream(
        '/music/generate',
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'generate', progress: Number(event.progress) || 0 });
          if (event.type === 'error')
            throw new Error(gpuBusyMessage(event) || String(event.reason || 'Music failed'));
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
      if (!abort.current?.signal.aborted) {
        const message = describeError(error);
        setFailure(message);
        toast.error(message);
      }
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
            <section className="space-y-2 rounded-(--card-radius) border border-border/60 bg-muted/15 p-3">
              <h2 className="text-sm font-medium">{t('musicStudio.engine_title')}</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                {t('musicStudio.engine_help')}
              </p>
              <Button className="w-full" disabled={busy} onClick={install}>
                {task?.kind === 'install' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon />
                )}
                {task?.kind === 'install'
                  ? t('musicStudio.engine_installing')
                  : t('musicStudio.engine_install')}
                {task?.kind === 'install' && installAmount(installStep) && (
                  <span
                    className="ml-auto text-xs tabular-nums opacity-80"
                    data-slot="install-amount"
                  >
                    {installAmount(installStep)}
                  </span>
                )}
              </Button>
              {task?.kind === 'install' && (
                <Progress
                  value={Math.round(task.progress * 100)}
                  aria-label={t('musicStudio.engine_installing')}
                />
              )}
              {task?.kind === 'install' && installStep && (
                <div className="space-y-0.5 text-xs leading-5" aria-live="polite">
                  <p className="text-muted-foreground tabular-nums">
                    {t(installStepLabel(installStep).key, installStepLabel(installStep).values)}
                  </p>
                  {installStep.log && (
                    <p
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={installStep.log}
                    >
                      {installStep.log}
                    </p>
                  )}
                </div>
              )}
            </section>
          ) : null}

          <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
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
            <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
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
          {!instrumental && (
            <div className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
              <span id="music-vocal-language" className="font-medium">
                {t('musicStudio.vocal_language')}
              </span>
              <Select
                value={vocalLanguage}
                disabled={busy}
                onValueChange={(value) => typeof value === 'string' && setVocalLanguage(value)}
              >
                <SelectTrigger aria-labelledby="music-vocal-language" className="w-full">
                  <SelectValue>
                    {languages.find((item) => item.value === vocalLanguage)?.label ?? vocalLanguage}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {languages.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
            <span className="font-medium">{t('musicStudio.bpm')}</span>
            <Input
              inputMode="numeric"
              value={bpm}
              disabled={busy}
              placeholder={t('musicStudio.bpm_hint')}
              onChange={(event) => setBpm(event.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </label>

          <Collapsible
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            className="rounded-(--card-radius) border border-border/60"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-label font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              {t('musicStudio.advanced')}
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', advancedOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 px-3 pb-3 text-xs">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span id="music-key" className="font-medium">
                    {t('musicStudio.key')}
                  </span>
                  <Select
                    value={keyScale || 'auto'}
                    disabled={busy}
                    onValueChange={(value) =>
                      typeof value === 'string' && setKeyScale(value === 'auto' ? '' : value)
                    }
                  >
                    <SelectTrigger aria-labelledby="music-key" className="w-full">
                      <SelectValue>
                        {keyScale ? keyLabel(keyScale) : t('musicStudio.auto')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t('musicStudio.auto')}</SelectItem>
                      {keyChoices.map((value) => (
                        <SelectItem key={value} value={value}>
                          {keyLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span id="music-meter" className="font-medium">
                    {t('musicStudio.time_signature')}
                  </span>
                  <ToggleGroup
                    value={[timeSignature || 'auto']}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-meter"
                    onValueChange={(value) => {
                      const next = value[0];
                      if (typeof next === 'string') setTimeSignature(next === 'auto' ? '' : next);
                    }}
                  >
                    <ToggleGroupItem value="auto">{t('musicStudio.auto')}</ToggleGroupItem>
                    {TIME_SIGNATURES.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {meterLabel(value)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-medium">{t('musicStudio.seed')}</span>
                  <div className="flex gap-1.5">
                    <Input
                      inputMode="numeric"
                      value={seed}
                      disabled={busy}
                      placeholder={t('musicStudio.seed_hint')}
                      onChange={(event) =>
                        setSeed(event.target.value.replace(/\D/g, '').slice(0, 10))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={t('musicStudio.seed_shuffle')}
                      title={t('musicStudio.seed_shuffle')}
                      onClick={() => setSeed(String(randomSeed()))}
                    >
                      <DicesIcon />
                    </Button>
                  </div>
                </label>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="space-y-1.5 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <BrainIcon className="size-3.5" aria-hidden="true" />
                {t('musicStudio.thinking')}
              </span>
              <Switch
                checked={thinking && lmReady}
                disabled={busy || !lmReady}
                onCheckedChange={setThinking}
              />
            </label>
            <p className="leading-5 text-muted-foreground">{t('musicStudio.thinking_help')}</p>
            {installed && lm.isPending && (
              <p className="text-muted-foreground">{t('musicStudio.thinking_checking')}</p>
            )}
            {lm.isError && (
              <p className="text-muted-foreground">{t('musicStudio.thinking_check_failed')}</p>
            )}
            {lm.isSuccess && !lmModel && (
              <p className="text-muted-foreground">{t('musicStudio.thinking_unsupported')}</p>
            )}
            {lmModel && !lmReady && (
              <Button
                className="w-full"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={downloadLm}
              >
                {task?.kind === 'lm' ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <DownloadIcon />
                )}
                {task?.kind === 'lm'
                  ? t('musicStudio.thinking_downloading')
                  : t('musicStudio.thinking_download', {
                      size: formatBytes(lm.data?.download_bytes ?? 0),
                    })}
              </Button>
            )}
            {task?.kind === 'lm' && (
              <Progress
                value={Math.round(task.progress * 100)}
                aria-label={t('musicStudio.thinking_downloading')}
              />
            )}
          </div>

          <Button
            className="w-full"
            size="lg"
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
            <>
              <Progress
                value={Math.round(task.progress * 100)}
                aria-label={t('musicStudio.generating')}
              />
              <Reveal>
                {task.progress < 0.1 && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {t('musicStudio.loading_model')}
                  </p>
                )}
              </Reveal>
            </>
          )}
          <Reveal>
            {failure && !busy && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
          </Reveal>
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
            <section className="space-y-2 rounded-(--card-radius) border border-border/60 bg-muted/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-medium">{selected.title}</h2>
                {typeof selected.seed === 'number' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setSeed(String(selected.seed));
                      setAdvancedOpen(true);
                    }}
                  >
                    <RotateCcwIcon />
                    {t('musicStudio.reuse_seed', { seed: selected.seed })}
                  </Button>
                )}
              </div>
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
                    // The chosen track is lit flat, like every selected row (DESIGN.md).
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 transition-colors',
                      selected?.id === track.id
                        ? 'bg-accent'
                        : 'bg-background/35 hover:bg-accent/50',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
