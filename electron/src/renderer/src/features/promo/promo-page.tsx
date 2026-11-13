import { useEffect, useMemo, useRef, useState } from 'react';
import { createPlayhead } from './playhead';
import { beatSyncActive, musicOffset, useBeatGrid } from './beat-grid';
import { PromoPreview } from './promo-preview';
import { PromoTimeline, type Selection } from './promo-timeline';
import { record, redo, snapToBeats, undo, type History } from './timeline-model';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClapperboardIcon,
  DownloadIcon,
  FileXIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  MusicIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { getBridge } from '@/components/bridge';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { SecondarySidebar } from '@/components/workspace-sidebar';
import { PipelineFailure } from '@/components/pipeline-failure';
import { VideoPlayer } from '@/components/video-player';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { saveExport } from '@/lib/export-history';
import {
  CORNERS,
  FPS_CHOICES,
  LOOKS,
  MAX_OUTRO_SECONDS,
  MAX_SHOT_SECONDS,
  MAX_TRANSITION_SECONDS,
  MIN_SHOT_SECONDS,
  SHAPES,
  TRANSITIONS,
  draftMedia,
  draftProblem,
  loadDraft,
  withoutMissing,
  moveShot,
  programLength,
  renderRequest,
  saveDraft,
  shotFor,
  type PromoDraft,
  type PromoMedia,
  type PromoShot,
} from './promo-model';
import { AnimatedOverlays } from './animated-overlays';
import { SceneEditor } from './scene-editor';
import { SceneWriter } from './scene-writer';
import { sceneShapeMismatch } from './scene-model';
import { useMissingMedia } from './missing-media';

interface RenderResult {
  output: string;
  duration: number;
  durations: number[];
  beat: number;
}

async function uploadMedia(file: File): Promise<PromoMedia> {
  const body = new FormData();
  body.set('file', file);
  return apiJson<PromoMedia>('/promo/media', { method: 'POST', body });
}

let shotCounter = 0;
const nextKey = () => `${Date.now().toString(36)}-${(shotCounter += 1)}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Choice<T extends string | number>({
  label,
  values,
  value,
  text,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  text: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map((option) => (
          <Button
            key={String(option)}
            size="xs"
            aria-pressed={value === option}
            variant={value === option ? 'secondary' : 'ghost'}
            onClick={() => onChange(option)}
          >
            {text(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MediaPicker({
  label,
  accept,
  media,
  missing = false,
  busy,
  onPick,
  onClear,
  icon: Icon,
}: {
  label: string;
  accept: string;
  media: PromoMedia | null;
  missing?: boolean;
  busy: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  icon: typeof MusicIcon;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="min-w-0 flex-1 justify-start"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {missing ? <FileXIcon className="text-destructive" /> : <Icon />}
        <span className="truncate">{media ? media.name : label}</span>
        {missing && (
          <span className="shrink-0 text-destructive">{t('promo.media_missing')}</span>
        )}
      </Button>
      {media && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('promo.remove')}
          disabled={busy}
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

function ShotRow({
  shot,
  index,
  count,
  missing,
  otherShape = false,
  busy,
  onChange,
  onMove,
  onRemove,
}: {
  shot: PromoShot;
  index: number;
  count: number;
  missing: boolean;
  /** A rendered scene made for another format than the draft's. */
  otherShape?: boolean;
  busy: boolean;
  onChange: (patch: Partial<PromoShot>) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const preview = apiPath(shot.media.url);
  const number = (value: string, min: number, max: number) =>
    Math.min(max, Math.max(min, Number(value) || min));
  return (
    <li className="flex gap-3 rounded-(--card-radius) border border-border/60 bg-background/35 p-2.5">
      <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {missing ? (
          <FileXIcon className="size-5 text-destructive" aria-hidden />
        ) : shot.media.kind === 'image' ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <video
            src={`${preview}#t=0.5`}
            muted
            preload="metadata"
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-sm">
            {shot.media.name}
            {missing && (
              <span className="ml-2 text-xs text-destructive">{t('promo.media_missing')}</span>
            )}
            {otherShape && (
              <span className="ml-2 text-xs text-muted-foreground">
                {t('promo.scene_warn_shape')}
              </span>
            )}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('promo.move_up')}
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('promo.move_down')}
            disabled={busy || index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('promo.remove')}
            disabled={busy}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
          <Field label={t('promo.duration')}>
            <Input
              type="number"
              step={0.1}
              min={MIN_SHOT_SECONDS}
              max={MAX_SHOT_SECONDS}
              value={shot.duration}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  duration: number(event.target.value, MIN_SHOT_SECONDS, MAX_SHOT_SECONDS),
                })
              }
            />
          </Field>
          {shot.media.kind === 'video' ? (
            <Field label={t('promo.start')}>
              <Input
                type="number"
                step={0.1}
                min={0}
                max={shot.media.duration ?? undefined}
                value={shot.start}
                disabled={busy}
                onChange={(event) =>
                  onChange({ start: number(event.target.value, 0, shot.media.duration ?? 3600) })
                }
              />
            </Field>
          ) : (
            <Field label={t('promo.motion')}>
              <Select
                items={(['none', 'zoom_in', 'zoom_out'] as const).map((value) => ({
                  value,
                  label: t(`promo.motion_${value}`),
                }))}
                value={shot.motion}
                disabled={busy}
                onValueChange={(value) => onChange({ motion: value as PromoShot['motion'] })}
              >
                <SelectTrigger aria-label={t('promo.motion')} className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['none', 'zoom_in', 'zoom_out'] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`promo.motion_${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('promo.transition')}>
            <Select
              items={TRANSITIONS.map((value) => ({ value, label: t(`promo.transition_${value}`) }))}
              value={shot.transition}
              disabled={busy || index === 0}
              onValueChange={(value) => onChange({ transition: value as PromoShot['transition'] })}
            >
              <SelectTrigger aria-label={t('promo.transition')} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSITIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`promo.transition_${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('promo.fit')}>
            <Select
              items={(['cover', 'contain'] as const).map((value) => ({
                value,
                label: t(`promo.fit_${value}`),
              }))}
              value={shot.fit}
              disabled={busy || (shot.media.kind === 'image' && shot.motion !== 'none')}
              onValueChange={(value) => onChange({ fit: value as PromoShot['fit'] })}
            >
              <SelectTrigger aria-label={t('promo.fit')} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['cover', 'contain'] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`promo.fit_${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {index > 0 && shot.transition !== 'cut' && (
          <Field label={t('promo.transition_seconds')}>
            <Slider
              min={0.1}
              max={MAX_TRANSITION_SECONDS}
              step={0.1}
              value={[shot.transitionSeconds]}
              disabled={busy}
              aria-label={t('promo.transition_seconds')}
              onValueChange={(value) =>
                onChange({ transitionSeconds: Array.isArray(value) ? value[0] : value })
              }
            />
          </Field>
        )}
      </div>
    </li>
  );
}

export function PromoPage() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PromoDraft>(() => loadDraft());
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const busy = uploading || rendering || overlayBusy;
  const total = programLength(draft);
  const missing = useMissingMedia(draftMedia(draft));
  const problem = draftProblem(draft, missing);

  useEffect(() => saveDraft(draft), [draft]);

  // Undo and redo cover every change to the draft, from the timeline and the lists alike.
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const previous = useRef(draft);
  const travelling = useRef(false);
  useEffect(() => {
    if (previous.current === draft) return;
    if (!travelling.current) {
      const before = previous.current;
      setHistory((current) => record(current, before));
    }
    travelling.current = false;
    previous.current = draft;
  }, [draft]);
  const travel = (step: typeof undo) => {
    const result = step(history, draft);
    if (!result) return;
    travelling.current = true;
    setHistory(result.history);
    setDraft(result.draft);
  };
  const [playhead] = useState(createPlayhead);
  // With Cut on the beat, the preview and the overlay warnings use the cut
  // lengths the render will use; the list inputs keep editing the raw draft.
  const grid = useBeatGrid(draft.music);
  const effective = useMemo(
    () => (beatSyncActive(draft, grid) ? snapToBeats(draft, grid.period) : draft),
    [draft, grid],
  );
  const [selection, setSelection] = useState<Selection>(null);
  const previewWidth = draft.shape === 'vertical' ? 200 : draft.shape === 'square' ? 260 : 340;

  const update = (patch: Partial<PromoDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const updateShot = (key: string, patch: Partial<PromoShot>) =>
    setDraft((current) => ({
      ...current,
      shots: current.shots.map((shot) => (shot.key === key ? { ...shot, ...patch } : shot)),
    }));

  const upload = async (files: File[], apply: (media: PromoMedia[]) => void) => {
    if (!files.length || busy) return;
    setUploading(true);
    setError(null);
    const done: PromoMedia[] = [];
    try {
      for (const file of files) done.push(await uploadMedia(file));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      if (done.length) apply(done);
      setUploading(false);
    }
  };

  const addShots = (files: File[]) =>
    upload(files, (media) =>
      setDraft((current) => ({
        ...current,
        shots: [
          ...current.shots,
          ...media.filter((item) => item.kind !== 'audio').map((item) => shotFor(item, nextKey())),
        ],
      })),
    );

  const render = async () => {
    if (problem || busy) return;
    setRendering(true);
    setError(null);
    setResult(null);
    try {
      const done = await apiJson<RenderResult>('/promo/render', {
        method: 'POST',
        body: JSON.stringify(renderRequest(draft)),
      });
      setResult(done);
      if (draft.snapToBeats && done.beat > 0)
        setDraft((current) => ({
          ...current,
          shots: current.shots.map((shot, index) => ({
            ...shot,
            duration: done.durations[index] ?? shot.duration,
          })),
        }));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setRendering(false);
    }
  };

  const save = async () => {
    if (!result) return;
    const url = apiPath('/audio/' + encodeURIComponent(result.output));
    if (getBridge()) await saveExport(url, result.output);
    else {
      const link = document.createElement('a');
      link.href = url;
      link.download = result.output;
      link.click();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">{t('promo.title')}</h1>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1 @max-[40rem]:flex-col">
        <SecondarySidebar
          title={t('promo.title')}
          icon={ClapperboardIcon}
          size="wide"
          variant="controls"
          className="space-y-4"
        >
          <Choice
            label={t('promo.format')}
            values={SHAPES}
            value={draft.shape}
            text={(value) => t(`promo.shape_${value}`)}
            onChange={(shape) => update({ shape })}
          />
          <Choice
            label={t('promo.fps')}
            values={FPS_CHOICES}
            value={draft.fps}
            text={(value) => `${value} fps`}
            onChange={(fps) => update({ fps })}
          />
          <Choice
            label={t('promo.look')}
            values={LOOKS}
            value={draft.look}
            text={(value) => t(`promo.look_${value}`)}
            onChange={(look) => update({ look })}
          />

          <section className="space-y-2">
            <h2 className="text-xs font-medium">{t('promo.music')}</h2>
            <MediaPicker
              label={t('promo.music_add')}
              accept="audio/*,video/*"
              media={draft.music}
              missing={!!draft.music && missing.has(draft.music.id)}
              busy={busy}
              icon={MusicIcon}
              onPick={(file) => upload([file], ([music]) => update({ music }))}
              onClear={() => update({ music: null })}
            />
            {draft.music && (
              <>
                <Field label={t('promo.music_volume')}>
                  <Slider
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={[draft.musicVolume]}
                    disabled={busy}
                    aria-label={t('promo.music_volume')}
                    onValueChange={(value) =>
                      update({ musicVolume: Array.isArray(value) ? value[0] : value })
                    }
                  />
                </Field>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span>{t('promo.snap_beats')}</span>
                  <Switch
                    aria-label={t('promo.snap_beats')}
                    checked={draft.snapToBeats}
                    disabled={busy}
                    onCheckedChange={(snapToBeats) => update({ snapToBeats })}
                  />
                </div>
              </>
            )}
            <MediaPicker
              label={t('promo.narration_add')}
              accept="audio/*"
              media={draft.narration}
              missing={!!draft.narration && missing.has(draft.narration.id)}
              busy={busy}
              icon={MusicIcon}
              onPick={(file) => upload([file], ([narration]) => update({ narration }))}
              onClear={() => update({ narration: null })}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-medium">{t('promo.brand')}</h2>
            <MediaPicker
              label={t('promo.logo_add')}
              accept="image/png,image/webp,image/jpeg"
              media={draft.logo}
              missing={!!draft.logo && missing.has(draft.logo.id)}
              busy={busy}
              icon={ImagePlusIcon}
              onPick={(file) => upload([file], ([logo]) => update({ logo }))}
              onClear={() => update({ logo: null })}
            />
            {draft.logo && (
              <>
                <Choice
                  label={t('promo.watermark')}
                  values={CORNERS}
                  value={draft.watermark}
                  text={(value) => t(`promo.corner_${value}`)}
                  onChange={(watermark) => update({ watermark })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('promo.outro')}>
                    <Input
                      type="number"
                      min={0}
                      max={MAX_OUTRO_SECONDS}
                      step={0.5}
                      value={draft.outroSeconds}
                      disabled={busy}
                      onChange={(event) =>
                        update({
                          outroSeconds: Math.min(
                            MAX_OUTRO_SECONDS,
                            Math.max(0, Number(event.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={t('promo.outro_color')}>
                    <Input
                      type="color"
                      value={draft.outroColor}
                      disabled={busy}
                      className="h-8 p-1"
                      onChange={(event) => update({ outroColor: event.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}
          </section>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('promo.total', { seconds: total.toFixed(1) })}
            </p>
            {problem && problem !== 'empty' && (
              <p className="text-xs text-destructive">{t(`promo.problem_${problem}`)}</p>
            )}
            {problem === 'missing_media' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() => setDraft((current) => withoutMissing(current, missing))}
              >
                <Trash2Icon />
                {t('promo.remove_missing')}
              </Button>
            )}
            <Button className="w-full" disabled={!!problem || busy} onClick={() => void render()}>
              {rendering ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ClapperboardIcon />
              )}
              {t(rendering ? 'promo.rendering' : 'promo.render')}
            </Button>
          </div>
        </SecondarySidebar>

        <main className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {error && (
            <PipelineFailure
              fallback={error}
              onDismiss={() => setError(null)}
              className="text-xs"
            />
          )}
          {result && (
            <section className="space-y-2 rounded-(--card-radius) border border-border/60 bg-muted/15 p-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{t('promo.result')}</h2>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => void save()}>
                  <DownloadIcon />
                  {t('promo.save')}
                </Button>
              </div>
              <div className="mx-auto max-w-sm">
                <VideoPlayer
                  key={result.output}
                  src={apiPath('/audio/' + encodeURIComponent(result.output))}
                  controls="compact"
                />
              </div>
            </section>
          )}
          {draft.shots.length > 0 && (
            <section className="flex flex-wrap items-start gap-4">
              <PromoPreview
                draft={effective}
                playhead={playhead}
                width={previewWidth}
                musicStart={musicOffset(draft, grid)}
              />
              <div className="min-w-[18rem] flex-1">
                <PromoTimeline
                  draft={draft}
                  busy={busy}
                  playhead={playhead}
                  selection={selection}
                  canUndo={history.past.length > 0}
                  canRedo={history.future.length > 0}
                  onSelect={setSelection}
                  onCommit={setDraft}
                  onUndo={() => travel(undo)}
                  onRedo={() => travel(redo)}
                  newKey={nextKey}
                  grid={grid}
                />
              </div>
            </section>
          )}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{t('promo.shots')}</h2>
              <input
                ref={shotInput}
                type="file"
                accept="video/*,image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  void addShots(files);
                }}
              />
              {draft.shots.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => update({ shots: [] })}
                >
                  {t('promo.clear')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className={draft.shots.length ? '' : 'ml-auto'}
                disabled={busy}
                onClick={() => shotInput.current?.click()}
              >
                {uploading ? (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <ImagePlusIcon />
                )}
                {t(uploading ? 'promo.uploading' : 'promo.add_media')}
              </Button>
            </div>
            {draft.shots.length === 0 ? (
              <p
                role="status"
                className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground"
              >
                {t('promo.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {draft.shots.map((shot, index) => (
                  <ShotRow
                    key={shot.key}
                    shot={shot}
                    index={index}
                    count={draft.shots.length}
                    missing={missing.has(shot.media.id)}
                    otherShape={sceneShapeMismatch(draft, shot)}
                    busy={busy}
                    onChange={(patch) => updateShot(shot.key, patch)}
                    onMove={(step) =>
                      setDraft((current) => ({
                        ...current,
                        shots: moveShot(current.shots, index, step),
                      }))
                    }
                    onRemove={() =>
                      setDraft((current) => ({
                        ...current,
                        shots: current.shots.filter((item) => item.key !== shot.key),
                      }))
                    }
                  />
                ))}
              </ul>
            )}
          </section>
          <SceneEditor
            draft={effective}
            busy={busy}
            onBusy={setOverlayBusy}
            onAddOverlay={(overlay) =>
              setDraft((current) => ({ ...current, overlays: [...current.overlays, overlay] }))
            }
            onAddShot={(shot) =>
              setDraft((current) => ({ ...current, shots: [...current.shots, shot] }))
            }
            aiSlot={(load) => <SceneWriter disabled={busy} onScene={load} />}
          />
          <AnimatedOverlays
            draft={effective}
            busy={busy}
            onBusy={setOverlayBusy}
            onAdd={(overlay) =>
              setDraft((current) => ({ ...current, overlays: [...current.overlays, overlay] }))
            }
            onChange={(key, patch) =>
              setDraft((current) => ({
                ...current,
                overlays: current.overlays.map((item) =>
                  item.key === key ? { ...item, ...patch } : item,
                ),
              }))
            }
            onRemove={(key) =>
              setDraft((current) => ({
                ...current,
                overlays: current.overlays.filter((item) => item.key !== key),
              }))
            }
          />
        </main>
      </div>
    </div>
  );
}
