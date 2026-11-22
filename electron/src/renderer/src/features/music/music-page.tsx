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
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  WandSparklesIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBridge } from '@/components/bridge';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { SecondarySidebar } from '@/components/workspace-sidebar';
import { HelpHint, TitleWithHelp } from '@/components/help-hint';
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
  AUDIO_FORMATS,
  BASE_TASKS,
  BATCH_SIZES,
  DEFAULT_STEPS,
  DIT_MODELS,
  DIT_MODEL_IDS,
  EXTEND_OVERLAP,
  EXTEND_SECONDS,
  EXTEND_SIDES,
  GUIDANCE_RANGE,
  LM_NEGATIVE_PROMPT_DEFAULT,
  LM_PARAMS,
  LM_PARAM_IDS,
  MAX_SOURCE_SECONDS,
  SHIFT_RANGE,
  INFER_METHODS,
  KEY_NOTES,
  LYRIC_TAGS,
  STYLE_TAGS,
  TIME_SIGNATURES,
  TRACK_NAMES,
  appendStyleTag,
  changedLmValues,
  defaultLmValues,
  defaultVocalLanguage,
  extendedLength,
  insertLyricTag,
  meterLabel,
  randomSeed,
  settingsFromTrack,
  stepsFor,
  vocalLanguageOptions,
  type AudioFormat,
  type DitModel,
  type ExtendSide,
  type InferMethod,
  type LmValues,
  type MusicSettings,
  type StyleGroup,
  type TrackName,
} from './music-options';
import { MusicSourcePicker, sourceFields, type MusicSource } from './music-source-picker';
import { MusicLora } from './music-lora';
import { BusyLabel, JobProgress, useEta } from '@/components/busy-label';
import {
  MusicFormatDialog,
  applyFormat,
  type FormatFields,
  type FormatSuggestion,
} from './music-format-dialog';

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
  vocal_language?: string;
  ext?: string;
  inference_steps?: number;
  infer_method?: string;
  // Variants made together share the first variant's id; `variant` counts from 1.
  batch_id?: string | null;
  variant?: number | null;
  task?: string;
};

type MusicTask = 'text2music' | 'cover' | 'repaint' | 'extend' | (typeof BASE_TASKS)[number];
const MUSIC_TASKS: MusicTask[] = ['text2music', 'cover', 'repaint', 'extend', ...BASE_TASKS];
const isBaseTask = (task: MusicTask) => (BASE_TASKS as readonly string[]).includes(task);
const REPAINT_MODES = ['conservative', 'balanced', 'aggressive'] as const;
type RepaintMode = (typeof REPAINT_MODES)[number];

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
  const [batchSize, setBatchSize] = useState('1');
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [inferMethod, setInferMethod] = useState<InferMethod>('ode');
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('wav');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatNext, setFormatNext] = useState<FormatFields | null>(null);
  const [formatLyricsKept, setFormatLyricsKept] = useState(false);
  const lyricsRef = useRef<HTMLTextAreaElement | null>(null);
  const [musicTask, setMusicTask] = useState<MusicTask>('text2music');
  const [source, setSource] = useState<MusicSource | null>(null);
  const [reference, setReference] = useState<MusicSource | null>(null);
  const [coverStrength, setCoverStrength] = useState(0.7);
  const [repaintRange, setRepaintRange] = useState<[number, number]>([0, 10]);
  const [repaintMode, setRepaintMode] = useState<RepaintMode>('balanced');
  const [repaintStrength, setRepaintStrength] = useState(0.5);
  const [extendSide, setExtendSide] = useState<ExtendSide>('end');
  const [extendSeconds, setExtendSeconds] = useState<number>(EXTEND_SECONDS[2]);
  const [extendOverlap, setExtendOverlap] = useState<number>(EXTEND_OVERLAP[2]);
  const [expertOpen, setExpertOpen] = useState(false);
  const [lmValues, setLmValues] = useState<LmValues>(defaultLmValues);
  const [lmNegative, setLmNegative] = useState('');
  const [trackName, setTrackName] = useState<TrackName>('vocals');
  const [trackClasses, setTrackClasses] = useState<TrackName[]>(['drums', 'bass']);
  const [globalCaption, setGlobalCaption] = useState('');
  const editing = musicTask !== 'text2music';
  const regenerating = musicTask === 'repaint' || musicTask === 'extend';
  const [model, setModel] = useState<DitModel>('turbo');
  const [guidance, setGuidance] = useState<number>(GUIDANCE_RANGE[2]);
  const [shift, setShift] = useState<number>(SHIFT_RANGE[2]);
  const [useAdg, setUseAdg] = useState(false);
  const [cfgInterval, setCfgInterval] = useState<[number, number]>([0, 1]);
  const chooseModel = (next: DitModel) => {
    setModel(next);
    // Stem tasks only run on Base: leaving it goes back to a new song.
    if (next !== 'base' && isBaseTask(musicTask)) setMusicTask('text2music');
    // Still on the old model's default: take the new one's; a chosen value is kept if it fits.
    setSteps((value) =>
      value === DIT_MODELS[model].steps[2] ? DIT_MODELS[next].steps[2] : stepsFor(next, value),
    );
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<{
    kind: 'install' | 'generate' | 'lm' | 'model';
    progress: number;
  } | null>(null);
  const [installStep, setInstallStep] = useState<InstallStep | null>(null);
  // The time left for the running job, shown in its button (DESIGN.md: progress lives in the button).
  const taskEta = useEta(task?.progress ?? null, { running: task !== null, resetKey: task?.kind });
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
  const models = useQuery({
    queryKey: ['music-models'],
    queryFn: () =>
      apiJson<{ models: { id: DitModel; installed: boolean; download_bytes: number }[] }>(
        '/music/models',
      ),
    enabled: installed,
  });
  const modelInfo = models.data?.models.find((item) => item.id === model);
  const modelReady = model === 'turbo' || Boolean(modelInfo?.installed);
  const guided = DIT_MODELS[model].guidance;
  const [minSteps, maxSteps] = DIT_MODELS[model].steps;
  const languages = vocalLanguageOptions(i18n.language);
  const keyLabel = (value: string) => {
    const [note, mode] = value.split(' ');
    return mode === 'minor'
      ? t('musicStudio.key_minor', { note })
      : t('musicStudio.key_major', { note });
  };
  const keyChoices = KEY_NOTES.flatMap((note) => [`${note} major`, `${note} minor`]);

  const settings: MusicSettings = {
    prompt,
    lyrics,
    instrumental,
    duration,
    bpm,
    vocalLanguage,
    keyScale,
    timeSignature,
    seed,
    thinking,
    batchSize,
    steps,
    inferMethod,
    audioFormat,
    model,
  };
  const applySettings = (next: MusicSettings) => {
    setPrompt(next.prompt);
    setLyrics(next.lyrics);
    setInstrumental(next.instrumental);
    setDuration(next.duration);
    setBpm(next.bpm);
    setVocalLanguage(next.vocalLanguage);
    setKeyScale(next.keyScale);
    setTimeSignature(next.timeSignature);
    setSeed(next.seed);
    setThinking(next.thinking);
    setBatchSize(next.batchSize);
    setSteps(next.steps);
    setInferMethod(next.inferMethod);
    setAudioFormat(next.audioFormat);
    setModel(next.model);
  };
  const formatFields: FormatFields = {
    prompt,
    lyrics,
    bpm,
    keyScale,
    timeSignature,
    duration,
    vocalLanguage,
  };
  const describeField = (key: keyof FormatFields, value: string) => {
    if (!value) return '';
    if (key === 'keyScale') return keyLabel(value);
    if (key === 'timeSignature') return meterLabel(value);
    if (key === 'duration') return t('musicStudio.duration_value', { seconds: Number(value) });
    if (key === 'vocalLanguage')
      return languages.find((item) => item.value === value)?.label ?? value;
    return value;
  };
  const requestBody = () => ({
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
    ...(thinking && lmReady ? changedLmValues(lmValues, lmNegative) : {}),
    batch_size: Number(batchSize),
    inference_steps: steps,
    infer_method: inferMethod,
    audio_format: audioFormat,
    model,
    ...(guided
      ? {
          guidance_scale: guidance,
          shift,
          use_adg: useAdg,
          cfg_interval_start: cfgInterval[0],
          cfg_interval_end: cfgInterval[1],
        }
      : {}),
    task: musicTask,
    ...(editing ? sourceFields(source, 'source') : {}),
    ...sourceFields(reference, 'reference'),
    ...(musicTask === 'cover' ? { cover_strength: coverStrength } : {}),
    ...(musicTask === 'repaint'
      ? { repaint_start: repaintRange[0], repaint_end: repaintRange[1] }
      : {}),
    ...(musicTask === 'extend'
      ? { extend_side: extendSide, extend_seconds: extendSeconds, extend_overlap: extendOverlap }
      : {}),
    ...(regenerating ? { repaint_mode: repaintMode, repaint_strength: repaintStrength } : {}),
    ...(musicTask === 'extract' || musicTask === 'lego' ? { track_name: trackName } : {}),
    ...(musicTask === 'complete' ? { track_classes: trackClasses } : {}),
    ...(musicTask === 'lego' && globalCaption.trim() ? { global_caption: globalCaption } : {}),
  });
  // The most the source can grow: its engine limit, and the slider's own range.
  const extendMax = source
    ? Math.max(
        EXTEND_SECONDS[0],
        Math.min(EXTEND_SECONDS[1], Math.floor(MAX_SOURCE_SECONDS - source.duration)),
      )
    : EXTEND_SECONDS[1];

  const chooseSource = (next: MusicSource | null) => {
    setSource(next);
    if (next) {
      // Start the repaint region on the middle third, a common place for a fix.
      const third = Math.max(1, Math.round(next.duration / 3));
      setRepaintRange([third, Math.min(Math.round(next.duration), third * 2)]);
    }
  };
  const editTrack = (task: MusicTask, track: Track) => {
    setMusicTask(task);
    chooseSource({
      kind: 'track',
      id: track.id,
      name: track.variant
        ? `${track.title} · ${t('musicStudio.variant_label', { n: track.variant })}`
        : track.title,
      duration: track.duration,
    });
  };

  const insertTag = (tag: string) => {
    const field = lyricsRef.current;
    const at = field ? field.selectionStart : lyrics.length;
    const next = insertLyricTag(lyrics, at, tag);
    setLyrics(next.text);
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const runFormat = async () => {
    setFormatting(true);
    try {
      const suggestion = await apiJson<FormatSuggestion>('/music/format', {
        method: 'POST',
        body: JSON.stringify(requestBody()),
      });
      setFormatLyricsKept(!instrumental && Boolean(suggestion.lyrics_kept));
      setFormatNext(applyFormat(formatFields, suggestion, instrumental));
    } catch (error) {
      toast.error(t('musicStudio.format_failed', { message: describeError(error) }));
    } finally {
      setFormatting(false);
    }
  };

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

  const downloadModel = async () => {
    setTask({ kind: 'model', progress: 0 });
    try {
      await consumeTaskStream(
        `/music/model-install-stream?model=${encodeURIComponent(model)}`,
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'model', progress: Number(event.progress) || 0 });
          if (event.type === 'error') throw new Error(String(event.reason || 'Download failed'));
          return event.type === 'done';
        },
      );
    } catch (error) {
      toast.error(t('musicStudio.model_download_failed', { message: describeError(error) }));
    } finally {
      setTask(null);
      void queryClient.invalidateQueries({ queryKey: ['music-models'] });
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
      const body = requestBody();
      let saved = 0;
      await consumeTaskStream(
        '/music/generate',
        (event) => {
          if (event.type === 'progress')
            setTask({ kind: 'generate', progress: Number(event.progress) || 0 });
          if (event.type === 'error')
            throw new Error(gpuBusyMessage(event) || String(event.reason || 'Music failed'));
          if (event.type === 'track') {
            saved += 1;
            const track = event.track as Track | undefined;
            if (track?.id && saved === 1) setSelectedId(track.id);
            void queryClient.invalidateQueries({ queryKey: ['music-library'] });
          }
          if (event.type === 'done') {
            const track = event.track as Track | undefined;
            if (track?.id && saved === 0) setSelectedId(track.id);
            saved = Math.max(saved, Array.isArray(event.tracks) ? event.tracks.length : 1);
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
      toast.success(
        saved > 1 ? t('musicStudio.generated_many', { count: saved }) : t('musicStudio.generated'),
      );
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
    const base = track.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'music';
    const name = `${base}${track.variant ? ` ${track.variant}` : ''}.${track.ext || 'wav'}`;
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
          titleAction={
            <HelpHint label={t('musicStudio.title')}>{t('musicStudio.credit')}</HelpHint>
          }
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
                  <Reveal>
                    {installStep.log && (
                      <p
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={installStep.log}
                      >
                        {installStep.log}
                      </p>
                    )}
                  </Reveal>
                </div>
              )}
            </section>
          ) : null}

          <div className="flex min-w-0 flex-col gap-1.5 text-label">
            <TitleWithHelp
              id="music-task"
              title={t('musicStudio.task')}
              help={t(`musicStudio.task_${musicTask}_help`)}
            />
            <ToggleGroup
              value={[musicTask]}
              disabled={busy}
              size="sm"
              // Seven modes do not fit one row of the control column: they wrap instead of clipping.
              className="flex-wrap"
              aria-labelledby="music-task"
              onValueChange={(value) => {
                const next = value[0];
                if (MUSIC_TASKS.includes(next as MusicTask)) setMusicTask(next as MusicTask);
              }}
            >
              {MUSIC_TASKS.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  disabled={isBaseTask(value) && !(model === 'base' && modelReady)}
                >
                  {t(`musicStudio.task_${value}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {model !== 'base' && (
              <p className="leading-5 text-muted-foreground">{t('musicStudio.task_base_only')}</p>
            )}
          </div>
          {editing && (
            <MusicSourcePicker
              id="music-source"
              label={t('musicStudio.source')}
              tracks={tracks}
              value={source}
              disabled={busy}
              onChange={chooseSource}
            />
          )}
          <Reveal>
            {musicTask === 'cover' && (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <TitleWithHelp
                    title={t('musicStudio.cover_strength')}
                    help={t('musicStudio.cover_strength_help')}
                  />
                  <span className="text-muted-foreground tabular-nums">
                    {Math.round(coverStrength * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[coverStrength]}
                  disabled={busy}
                  aria-label={t('musicStudio.cover_strength')}
                  onValueChange={(value) =>
                    setCoverStrength(Array.isArray(value) ? value[0] : value)
                  }
                />
              </div>
            )}
          </Reveal>
          {isBaseTask(musicTask) && (
            <div className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <span className="font-medium">
                  {musicTask === 'complete'
                    ? t('musicStudio.track_classes')
                    : t(`musicStudio.track_name_${musicTask}`)}
                </span>
                <div className="flex flex-wrap gap-1">
                  {TRACK_NAMES.map((name) => {
                    const on =
                      musicTask === 'complete' ? trackClasses.includes(name) : trackName === name;
                    return (
                      <Button
                        key={name}
                        size="xs"
                        variant={on ? 'secondary' : 'ghost'}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => {
                          if (musicTask !== 'complete') setTrackName(name);
                          else
                            setTrackClasses((current) =>
                              current.includes(name)
                                ? current.filter((item) => item !== name)
                                : [...current, name],
                            );
                        }}
                      >
                        {t(`musicStudio.track_${name}`)}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <Reveal>
                {musicTask === 'lego' && (
                  <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="font-medium">{t('musicStudio.global_caption')}</span>
                    <Input
                      value={globalCaption}
                      maxLength={1000}
                      disabled={busy}
                      placeholder={t('musicStudio.global_caption_placeholder')}
                      onChange={(event) => setGlobalCaption(event.target.value)}
                    />
                  </label>
                )}
              </Reveal>
            </div>
          )}
          <Reveal>
            {musicTask === 'extend' && source && (
              <div className="space-y-3 text-xs">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span id="music-extend-side" className="font-medium">
                    {t('musicStudio.extend_side')}
                  </span>
                  <ToggleGroup
                    value={[extendSide]}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-extend-side"
                    onValueChange={(value) => {
                      const next = value[0];
                      if ((EXTEND_SIDES as readonly string[]).includes(next as string))
                        setExtendSide(next as ExtendSide);
                    }}
                  >
                    {EXTEND_SIDES.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {t(`musicStudio.extend_side_${value}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t('musicStudio.extend_seconds')}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t('musicStudio.duration_value', {
                        seconds: Math.min(extendSeconds, extendMax),
                      })}
                    </span>
                  </div>
                  <Slider
                    min={EXTEND_SECONDS[0]}
                    max={extendMax}
                    step={1}
                    value={[Math.min(extendSeconds, extendMax)]}
                    disabled={busy}
                    aria-label={t('musicStudio.extend_seconds')}
                    onValueChange={(value) =>
                      setExtendSeconds(Array.isArray(value) ? value[0] : value)
                    }
                  />
                  <p className="leading-5 text-muted-foreground">
                    {t('musicStudio.extend_total', {
                      seconds: extendedLength(source.duration, Math.min(extendSeconds, extendMax)),
                    })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <TitleWithHelp
                      title={t('musicStudio.extend_overlap')}
                      help={t('musicStudio.extend_overlap_help')}
                    />
                    <span className="text-muted-foreground tabular-nums">
                      {t('musicStudio.duration_value', { seconds: extendOverlap })}
                    </span>
                  </div>
                  <Slider
                    min={EXTEND_OVERLAP[0]}
                    max={EXTEND_OVERLAP[1]}
                    step={0.5}
                    value={[extendOverlap]}
                    disabled={busy}
                    aria-label={t('musicStudio.extend_overlap')}
                    onValueChange={(value) =>
                      setExtendOverlap(Array.isArray(value) ? value[0] : value)
                    }
                  />
                </div>
              </div>
            )}
          </Reveal>
          {regenerating && source && (
            <div className="space-y-3 text-xs">
              <Reveal>
                {musicTask === 'repaint' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{t('musicStudio.repaint_region')}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {t('musicStudio.repaint_region_value', {
                          start: repaintRange[0],
                          end: repaintRange[1],
                        })}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={Math.max(1, Math.round(source.duration))}
                      step={1}
                      minStepsBetweenValues={1}
                      value={repaintRange}
                      disabled={busy}
                      aria-label={t('musicStudio.repaint_region')}
                      onValueChange={(value) => {
                        if (Array.isArray(value) && value.length === 2)
                          setRepaintRange([value[0], value[1]]);
                      }}
                    />
                  </div>
                )}
              </Reveal>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span id="music-repaint-mode" className="font-medium">
                  {t('musicStudio.repaint_mode')}
                </span>
                <ToggleGroup
                  value={[repaintMode]}
                  disabled={busy}
                  size="sm"
                  aria-labelledby="music-repaint-mode"
                  onValueChange={(value) => {
                    const next = value[0];
                    if ((REPAINT_MODES as readonly string[]).includes(next as string))
                      setRepaintMode(next as RepaintMode);
                  }}
                >
                  {REPAINT_MODES.map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {t(`musicStudio.repaint_mode_${value}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <Reveal>
                {repaintMode === 'balanced' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{t('musicStudio.repaint_strength')}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round(repaintStrength * 100)}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[repaintStrength]}
                      disabled={busy}
                      aria-label={t('musicStudio.repaint_strength')}
                      onValueChange={(value) =>
                        setRepaintStrength(Array.isArray(value) ? value[0] : value)
                      }
                    />
                  </div>
                )}
              </Reveal>
            </div>
          )}

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
          <Collapsible open={stylesOpen} onOpenChange={setStylesOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-label font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              {t('musicStudio.style_tags')}
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', stylesOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 pt-2">
                {(Object.keys(STYLE_TAGS) as StyleGroup[]).map((group) => (
                  <div
                    key={group}
                    className="space-y-1"
                    role="group"
                    aria-label={t(`musicStudio.style_group_${group}`)}
                  >
                    <p className="text-[11px] text-muted-foreground">
                      {t(`musicStudio.style_group_${group}`)}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {STYLE_TAGS[group].map((tag) => (
                        <Button
                          key={tag}
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setPrompt((value) => appendStyleTag(value, tag))}
                        >
                          {tag}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{t('musicStudio.instrumental')}</span>
            <Switch checked={instrumental} disabled={busy} onCheckedChange={setInstrumental} />
          </label>
          <Reveal>
            {!instrumental && (
              <label className="flex min-w-0 flex-col gap-1.5 text-label font-medium">
                <span className="font-medium">{t('musicStudio.lyrics')}</span>
                <div
                  className="flex flex-wrap gap-1"
                  role="toolbar"
                  aria-label={t('musicStudio.lyric_tags')}
                >
                  {LYRIC_TAGS.map((tag) => (
                    <Button
                      key={tag}
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      title={t('musicStudio.lyric_tag_insert', { tag: `[${tag}]` })}
                      onClick={() => insertTag(tag)}
                    >
                      [{tag}]
                    </Button>
                  ))}
                </div>
                <Textarea
                  ref={lyricsRef}
                  value={lyrics}
                  maxLength={8000}
                  rows={6}
                  disabled={busy}
                  placeholder={t('musicStudio.lyrics_placeholder')}
                  onChange={(event) => setLyrics(event.target.value)}
                />
              </label>
            )}
          </Reveal>
          <Reveal>
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
                      {languages.find((item) => item.value === vocalLanguage)?.label ??
                        vocalLanguage}
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
          </Reveal>

          {!editing && (
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
          )}
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

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} framed>
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
                  <TitleWithHelp
                    id="music-model"
                    title={t('musicStudio.model')}
                    help={t(`musicStudio.model_${model}_help`)}
                  />
                  <ToggleGroup
                    value={[model]}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-model"
                    onValueChange={(value) => {
                      const next = value[0];
                      if (DIT_MODEL_IDS.includes(next as DitModel)) chooseModel(next as DitModel);
                    }}
                  >
                    {DIT_MODEL_IDS.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {t(`musicStudio.model_${value}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {installed && !modelReady && (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={downloadModel}
                    >
                      {task?.kind === 'model' ? (
                        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <DownloadIcon />
                      )}
                      {task?.kind === 'model'
                        ? t('musicStudio.model_downloading')
                        : t('musicStudio.model_download', {
                            size: formatBytes(modelInfo?.download_bytes ?? 0),
                          })}
                    </Button>
                  )}
                  {task?.kind === 'model' && (
                    <Progress
                      value={Math.round(task.progress * 100)}
                      aria-label={t('musicStudio.model_downloading')}
                    />
                  )}
                </div>
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
                <div className="flex min-w-0 flex-col gap-1.5">
                  <TitleWithHelp
                    id="music-variants"
                    title={t('musicStudio.variants')}
                    help={t('musicStudio.variants_help')}
                  />
                  <ToggleGroup
                    value={[batchSize]}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-variants"
                    onValueChange={(value) => {
                      const next = value[0];
                      if (typeof next === 'string') setBatchSize(next);
                    }}
                  >
                    {BATCH_SIZES.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {value}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <TitleWithHelp
                      title={t('musicStudio.steps')}
                      help={t(guided ? 'musicStudio.steps_help_slow' : 'musicStudio.steps_help')}
                    />
                    <span className="text-muted-foreground tabular-nums">{steps}</span>
                  </div>
                  <Slider
                    min={minSteps}
                    max={maxSteps}
                    step={1}
                    value={[steps]}
                    disabled={busy}
                    aria-label={t('musicStudio.steps')}
                    onValueChange={(value) => setSteps(Array.isArray(value) ? value[0] : value)}
                  />
                </div>
                {guided && (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <TitleWithHelp
                          title={t('musicStudio.guidance')}
                          help={t('musicStudio.guidance_help')}
                        />
                        <span className="text-muted-foreground tabular-nums">{guidance}</span>
                      </div>
                      <Slider
                        min={GUIDANCE_RANGE[0]}
                        max={GUIDANCE_RANGE[1]}
                        step={0.5}
                        value={[guidance]}
                        disabled={busy}
                        aria-label={t('musicStudio.guidance')}
                        onValueChange={(value) =>
                          setGuidance(Array.isArray(value) ? value[0] : value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <TitleWithHelp
                          title={t('musicStudio.shift')}
                          help={t('musicStudio.shift_help')}
                        />
                        <span className="text-muted-foreground tabular-nums">{shift}</span>
                      </div>
                      <Slider
                        min={SHIFT_RANGE[0]}
                        max={SHIFT_RANGE[1]}
                        step={0.1}
                        value={[shift]}
                        disabled={busy}
                        aria-label={t('musicStudio.shift')}
                        onValueChange={(value) => setShift(Array.isArray(value) ? value[0] : value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <TitleWithHelp
                          title={t('musicStudio.cfg_interval')}
                          help={t('musicStudio.cfg_interval_help')}
                        />
                        <span className="text-muted-foreground tabular-nums">
                          {cfgInterval[0].toFixed(2)}–{cfgInterval[1].toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={cfgInterval}
                        disabled={busy}
                        aria-label={t('musicStudio.cfg_interval')}
                        onValueChange={(value) => {
                          if (Array.isArray(value) && value.length === 2)
                            setCfgInterval([value[0], value[1]]);
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <label htmlFor="music-adg" className="block font-medium">
                          {t('musicStudio.adg')}
                        </label>
                        <HelpHint label={t('musicStudio.adg')}>{t('musicStudio.adg_help')}</HelpHint>
                      </span>
                      <Switch
                        id="music-adg"
                        checked={useAdg}
                        disabled={busy}
                        onCheckedChange={setUseAdg}
                      />
                    </div>
                  </>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <TitleWithHelp
                    id="music-sampler"
                    title={t('musicStudio.sampler')}
                    help={t('musicStudio.sampler_help')}
                  />
                  <ToggleGroup
                    value={[inferMethod]}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-sampler"
                    onValueChange={(value) => {
                      const next = value[0];
                      if (next === 'ode' || next === 'sde') setInferMethod(next);
                    }}
                  >
                    {INFER_METHODS.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {t(`musicStudio.sampler_${value}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span id="music-format" className="font-medium">
                    {t('musicStudio.audio_format')}
                  </span>
                  <ToggleGroup
                    value={[audioFormat]}
                    disabled={busy}
                    size="sm"
                    aria-labelledby="music-format"
                    onValueChange={(value) => {
                      const next = value[0];
                      if ((AUDIO_FORMATS as readonly string[]).includes(next as string))
                        setAudioFormat(next as AudioFormat);
                    }}
                  >
                    {AUDIO_FORMATS.map((value) => (
                      <ToggleGroupItem key={value} value={value}>
                        {value.toUpperCase()}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <MusicSourcePicker
                  id="music-reference"
                  label={t('musicStudio.reference')}
                  hint={t('musicStudio.reference_help')}
                  tracks={tracks}
                  value={reference}
                  disabled={busy}
                  onChange={setReference}
                />
                <MusicLora model={model} disabled={busy} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="space-y-1.5 text-xs">
            {/* The ? sits outside the label: inside it, it would become the label's control. */}
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                <label htmlFor="music-thinking" className="flex items-center gap-1.5 font-medium">
                  <BrainIcon className="size-3.5" aria-hidden="true" />
                  {t('musicStudio.thinking')}
                </label>
                <HelpHint label={t('musicStudio.thinking')}>
                  {t('musicStudio.thinking_help')}
                </HelpHint>
              </span>
              <Switch
                id="music-thinking"
                checked={thinking && lmReady}
                disabled={busy || !lmReady}
                onCheckedChange={setThinking}
              />
            </div>
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
            <Reveal>
              {thinking && lmReady && (
                <Collapsible open={expertOpen} onOpenChange={setExpertOpen} framed>
                  <div className="flex items-center gap-1 pe-2">
                    <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-label font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                      {t('musicStudio.lm_expert')}
                      <ChevronDownIcon
                        className={cn('size-3.5 transition-transform', expertOpen && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </CollapsibleTrigger>
                    <HelpHint label={t('musicStudio.lm_expert')}>
                      {t('musicStudio.lm_expert_help')}
                    </HelpHint>
                  </div>
                  <CollapsibleContent>
                    <div className="space-y-3 px-3 pb-3">
                      {LM_PARAM_IDS.map((id) => {
                        const [low, high, fallback] = LM_PARAMS[id].range;
                        const value = lmValues[id];
                        return (
                          <div key={id} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{t(`musicStudio.${id}`)}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {value === null ? t('musicStudio.lm_top_k_off') : value}
                              </span>
                            </div>
                            <Slider
                              min={id === 'lm_top_k' ? 0 : low}
                              max={high}
                              step={LM_PARAMS[id].step}
                              value={[value ?? 0]}
                              disabled={busy}
                              aria-label={t(`musicStudio.${id}`)}
                              onValueChange={(next) => {
                                const raw = Array.isArray(next) ? next[0] : next;
                                const rounded = Math.round(raw * 100) / 100;
                                setLmValues((current) => ({
                                  ...current,
                                  [id]: id === 'lm_top_k' && rounded < low ? fallback : rounded,
                                }));
                              }}
                            />
                          </div>
                        );
                      })}
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="font-medium">{t('musicStudio.lm_negative_prompt')}</span>
                        <Input
                          value={lmNegative}
                          maxLength={500}
                          disabled={busy}
                          placeholder={LM_NEGATIVE_PROMPT_DEFAULT}
                          onChange={(event) => setLmNegative(event.target.value)}
                        />
                      </label>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setLmValues(defaultLmValues());
                          setLmNegative('');
                        }}
                      >
                        <RotateCcwIcon />
                        {t('musicStudio.lm_reset')}
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </Reveal>
          </div>

          {lmReady && (
            <div className="flex items-center gap-1 text-xs">
              <Button
                className="min-w-0 flex-1"
                size="sm"
                variant="secondary"
                disabled={busy || formatting || !prompt.trim()}
                onClick={runFormat}
              >
                {formatting ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <WandSparklesIcon />
                )}
                {formatting ? t('musicStudio.formatting') : t('musicStudio.format')}
              </Button>
              {/* 28 px, the height of the sm Format button beside it */}
              <HelpHint label={t('musicStudio.format')} className="size-7">
                {t('musicStudio.format_hint')}
              </HelpHint>
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={
              busy ||
              formatting ||
              !installed ||
              !modelReady ||
              !prompt.trim() ||
              (editing && !source) ||
              (musicTask === 'complete' && trackClasses.length === 0)
            }
            onClick={generate}
          >
            {task?.kind === 'generate' ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <SparklesIcon />
            )}
            {task?.kind === 'generate' ? (
              <BusyLabel
                label={t('musicStudio.generating')}
                progress={task.progress}
                eta={taskEta}
              />
            ) : Number(batchSize) > 1 ? (
              t('musicStudio.generate_many', { count: Number(batchSize) })
            ) : (
              t('musicStudio.generate')
            )}
          </Button>
          {task?.kind === 'generate' && (
            <>
              <JobProgress value={task.progress * 100} label={t('musicStudio.generating')} />
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
        </SecondarySidebar>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {selected && (
            <section className="space-y-2 rounded-(--card-radius) border border-border/60 bg-muted/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-medium">{selected.title}</h2>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      applySettings(settingsFromTrack(selected, settings));
                      setAdvancedOpen(true);
                      toast.success(t('musicStudio.settings_reused'));
                    }}
                  >
                    <SlidersHorizontalIcon />
                    {t('musicStudio.reuse_settings')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => editTrack('cover', selected)}
                  >
                    {t('musicStudio.cover_this')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => editTrack('repaint', selected)}
                  >
                    {t('musicStudio.repaint_this')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => editTrack('extend', selected)}
                  >
                    {t('musicStudio.extend_this')}
                  </Button>
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
                        {track.variant
                          ? ` · ${t('musicStudio.variant_label', { n: track.variant })}`
                          : ''}
                        {track.task === 'cover' || track.task === 'repaint'
                          ? ` · ${t(`musicStudio.task_${track.task}`)}`
                          : ''}
                        {track.ext && track.ext !== 'wav' ? ` · ${track.ext.toUpperCase()}` : ''}
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
      <MusicFormatDialog
        open={formatNext !== null}
        onOpenChange={(open) => !open && setFormatNext(null)}
        current={formatFields}
        next={formatNext ?? formatFields}
        describe={describeField}
        lyricsKept={formatLyricsKept}
        onApply={() => {
          if (!formatNext) return;
          setPrompt(formatNext.prompt);
          setLyrics(formatNext.lyrics);
          setBpm(formatNext.bpm);
          setKeyScale(formatNext.keyScale);
          setTimeSignature(formatNext.timeSignature);
          setDuration(formatNext.duration);
          setVocalLanguage(formatNext.vocalLanguage);
        }}
      />
    </div>
  );
}
