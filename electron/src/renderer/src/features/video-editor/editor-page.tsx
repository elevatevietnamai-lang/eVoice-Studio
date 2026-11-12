/**
 * Video editor: a CapCut-style workspace on OpenCut's renderer. Files on the
 * left, preview in the middle, properties on the right, tracks below.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause as PauseShape, Play as PlayShape } from 'lucide';
import {
  DownloadIcon,
  LoaderCircleIcon,
  Redo2Icon,
  ScissorsIcon,
  SquarePlayIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { SecondarySidebar } from '@/components/workspace-sidebar';
import { Button } from '@/components/ui/button';
import { MorphIcon } from '@/components/ui/morph-icon';
import { Progress } from '@/components/ui/progress';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { saveExport } from '@/lib/export-history';
import { getBridge } from '@/components/bridge';
import { EditorPlayer, exportProblem, exportProject, mixdownForSpeech } from './engine';
import { useMissingMedia } from './missing-media';
import { resolveNumberAtTime } from '@/lib/opencut/vendor/animation/values';
import { cn } from '@/lib/utils';
import { EditorTimeline } from './editor-timeline';
import { MediaBin } from './media-bin';
import { PropertiesPanel, type Apply } from './properties-panel';
import { formatTime, record, redo, undo, type History } from './format';
import {
  SHAPE_SIZE,
  allTracks,
  findElement,
  loadProject,
  projectSeconds,
  saveProject,
  secondsOf,
  ticks,
  type EditorMedia,
  type EditorProject,
  type ElementRef,
} from './project';
import {
  addCaptions,
  addMedia,
  captionsFromText,
  addText,
  deleteElement,
  hasKeyframes,
  insertMedia,
  localTicks,
  moveElement,
  setKeyframe,
  setParam,
  setTrackFlag,
  splitElement,
  trimElement,
  type CaptionSegment,
} from './timeline-ops';

const MERGE_WINDOW_MS = 800;
const MIN_ZOOM = 8;
const MAX_ZOOM = 400;

async function uploadMedia(file: File): Promise<EditorMedia> {
  const body = new FormData();
  body.set('file', file);
  return apiJson<EditorMedia>('/promo/media', { method: 'POST', body });
}

/** Shows a message in a live region that is always there, so it is announced when it changes. */
function Notice({ message, tone, onDismiss }: { message: string | null; tone: 'error' | 'info'; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="empty:hidden">
      {message ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
          <span className={tone === 'error' ? 'flex-1 text-destructive' : 'flex-1'}>{message}</span>
          <Button size="icon-xs" variant="ghost" aria-label={t('editor.dismiss')} onClick={onDismiss}>
            <XIcon />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function VideoEditorPage() {
  const { t } = useTranslation();
  const [project, setProject] = useState<EditorProject>(() => loadProject());
  const [history, setHistory] = useState<History<EditorProject>>({ past: [], future: [] });
  const merge = useRef<{ key: string; at: number } | null>(null);
  const [selection, setSelection] = useState<ElementRef | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(60);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const player = useRef<EditorPlayer | null>(null);
  player.current ??= new EditorPlayer(
    () => canvas.current,
    (seconds, isPlaying) => {
      setPlayhead(seconds);
      setPlaying(isPlaying);
    },
  );
  const length = projectSeconds(project);
  const { width, height } = SHAPE_SIZE[project.shape];
  const busy = exporting !== null;

  useEffect(() => {
    saveProject(project);
    player.current?.setProject(project).catch((cause) => setError(describeError(cause)));
  }, [project]);
  useEffect(() => () => player.current?.dispose(), []);

  // Edits read the latest project through a ref so several in one event chain correctly.
  const latest = useRef(project);
  latest.current = project;

  /** One edit; edits with the same key in quick succession (a slider drag) are one undo step. */
  const apply: Apply = useCallback((edit, mergeKey) => {
    const current = latest.current;
    const next = edit(current);
    if (next === current) return;
    const now = Date.now();
    const merging = mergeKey && merge.current?.key === mergeKey && now - merge.current.at < MERGE_WINDOW_MS;
    if (!merging) setHistory((h) => record(h, current));
    merge.current = mergeKey ? { key: mergeKey, at: now } : null;
    latest.current = next;
    setProject(next);
  }, []);

  /** An edit that also selects the clip it returns. */
  const applySelecting = (edit: (current: EditorProject) => { project: EditorProject; ref: ElementRef }) => {
    const picked: { ref: ElementRef | null } = { ref: null };
    apply((current) => {
      const result = edit(current);
      picked.ref = result.ref;
      return result.project;
    });
    if (picked.ref) setSelection(picked.ref);
  };

  const travel = (step: typeof undo) => {
    const result = step(history, project);
    if (!result) return;
    merge.current = null;
    setHistory(result.history);
    setProject(result.value);
    if (!findElement(result.value, selection)) setSelection(null);
  };

  const seek = useCallback((seconds: number) => {
    const target = Math.max(0, seconds);
    const engine = player.current!;
    const wasPlaying = engine.playing;
    if (wasPlaying) engine.pause();
    engine.show(target);
    setPlayhead(target);
    if (wasPlaying) void engine.play();
  }, []);

  const togglePlay = () => {
    const engine = player.current!;
    if (engine.playing) engine.pause();
    else {
      void engine.play();
      setPlaying(true);
    }
  };

  const selected = findElement(project, selection);

  const split = () => {
    if (!selection) return;
    applySelecting((current) => splitElement(current, selection, playhead));
  };

  const remove = () => {
    if (!selection) return;
    apply((current) => deleteElement(current, selection));
    setSelection(null);
  };

  const upload = async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const media = await uploadMedia(file);
        apply((current) => addMedia(current, media));
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setUploading(false);
    }
  };

  const [captioning, setCaptioning] = useState(false);
  /** Transcribes the project's sound with the local speech engine and adds captions. */
  const autoCaptions = async () => {
    setCaptioning(true);
    setError(null);
    setNotice(null);
    try {
      const sound = await mixdownForSpeech(latest.current);
      if (!sound) {
        setError(t('editor.captions_no_sound'));
        return;
      }
      const body = new FormData();
      body.set('audio', new File([sound.wav], 'mix.wav', { type: 'audio/wav' }));
      body.set('mode', 'accurate');
      const result = await apiJson<{ text?: string; segments?: CaptionSegment[] }>('/transcribe', {
        method: 'POST',
        body,
      });
      // Some engines return the words without timings: spread them over the speech.
      const timed = (result.segments ?? []).filter((segment) => segment.start !== null && segment.text.trim());
      const segments =
        timed.length || !result.text?.trim() || !sound.voiced
          ? timed
          : captionsFromText(result.text, sound.voiced.start, sound.voiced.end);
      if (!segments.length) {
        setNotice(t('editor.captions_none'));
        return;
      }
      apply((current) => addCaptions(current, segments, SHAPE_SIZE[current.shape]));
      setNotice(t('editor.captions_added', { n: segments.length }));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setCaptioning(false);
    }
  };

  /** Dragging on the preview moves the selected picture or title (keyframed when it has keyframes). */
  const moveOnCanvas = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const found = findElement(latest.current, selection);
    if (!found || !selection || found.element.type === 'audio' || event.button !== 0) return;
    const element = found.element;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const scale = width / target.getBoundingClientRect().width;
    const local = localTicks(element, playhead);
    const read = (path: 'transform.positionX' | 'transform.positionY') =>
      resolveNumberAtTime({
        baseValue: typeof element.params[path] === 'number' ? (element.params[path] as number) : 0,
        animations: element.animations,
        propertyPath: path,
        localTime: local,
      });
    const origin = { x: event.clientX, y: event.clientY, px: read('transform.positionX'), py: read('transform.positionY') };
    const keyed = hasKeyframes(element, 'transform.positionX') || hasKeyframes(element, 'transform.positionY');
    const ref = selection;
    const at = playhead;
    const onMove = (move: PointerEvent) => {
      const x = Math.round(origin.px + (move.clientX - origin.x) * scale);
      const y = Math.round(origin.py + (move.clientY - origin.y) * scale);
      apply((current) => {
        const write = (project: EditorProject, path: 'transform.positionX' | 'transform.positionY', value: number) =>
          keyed ? setKeyframe(project, ref, path, at, value) : setParam(project, ref, path, value);
        return write(write(current, 'transform.positionX', x), 'transform.positionY', y);
      }, `${ref.elementId}:canvas-move`);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const exportVideo = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setExporting(0);
    setError(null);
    setNotice(null);
    player.current?.pause();
    try {
      const result = await exportProject(project, setExporting, controller.signal);
      if (!result) return;
      const base = (project.name.trim() || t('editor.untitled')).replace(/[\\/:*?"<>|]+/g, '-');
      let media = await uploadMedia(new File([result.blob], `${base}.${result.format}`, { type: result.blob.type }));
      if (result.format === 'webm')
        media = await apiJson<EditorMedia>('/editor/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_id: media.id }),
        });
      const url = apiPath(media.url);
      if (getBridge()) {
        const saved = await saveExport(url, `${base}.mp4`);
        if (saved) setNotice(t('editor.export_saved'));
      } else {
        // The browser UI has no native save dialog: download the file instead.
        const link = document.createElement('a');
        link.href = url;
        link.download = `${base}.mp4`;
        link.click();
        setNotice(t('editor.export_saved'));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message === 'too_long' || message === 'empty' ? t(`editor.problem_${message}`) : describeError(cause));
    } finally {
      abort.current = null;
      setExporting(null);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || busy) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.code === 'Space') {
        event.preventDefault();
        // Space would also press whichever button has focus.
        if (event.target instanceof HTMLButtonElement) event.target.blur();
        togglePlay();
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        travel(event.shiftKey ? redo : undo);
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        travel(redo);
      } else if (!mod && event.key.toLowerCase() === 's') {
        split();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        remove();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = (event.shiftKey ? 1 : 1 / project.fps) * (event.key === 'ArrowLeft' ? -1 : 1);
        seek(playhead + step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const missing = useMissingMedia(project.media);
  const usedMissing = allTracks(project).some((track) =>
    track.elements.some((element) => 'mediaId' in element && missing.has(element.mediaId)),
  );
  const problem = exportProblem(project) ?? (usedMissing ? 'missing' : null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">{t('editor.title')}</h1>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1">
        <SecondarySidebar title={t('editor.media')} icon={SquarePlayIcon} size="wide" variant="controls">
          <MediaBin
            project={project}
            uploading={uploading}
            onUpload={(files) => void upload(files)}
            onAddText={() => applySelecting((current) => addText(current, playhead, t('editor.text_default')))}
            missing={missing}
            captioning={captioning}
            onCaptions={() => void autoCaptions()}
            onAdd={(media, placement) => {
              applySelecting((current) => insertMedia(current, media, playhead, placement));
              // Like CapCut, the playhead moves past a clip added to the main track,
              // so the next one lands after it.
              const added = placement === 'main' ? latest.current.tracks.main.elements : [];
              const placed = added.find((element) => 'mediaId' in element && element.mediaId === media.id && element.startTime + element.duration > ticks(playhead));
              if (placed && media.kind !== 'audio') seek(secondsOf(placed.startTime + placed.duration));
            }}
          />
        </SecondarySidebar>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
          <Notice message={error} tone="error" onDismiss={() => setError(null)} />
          <Notice message={notice} tone="info" onDismiss={() => setNotice(null)} />
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2">
              <canvas
                ref={canvas}
                width={width / 2}
                height={height / 2}
                className={cn(
                  'max-h-full max-w-full min-h-0 touch-none rounded-lg bg-black object-contain',
                  selected && selected.element.type !== 'audio' && 'cursor-move',
                )}
                style={{ aspectRatio: `${width} / ${height}` }}
                aria-label={t('editor.preview')}
                onPointerDown={moveOnCanvas}
              />
            </div>
            <aside className="w-72 shrink-0 overflow-y-auto pr-1" aria-label={t('editor.properties')}>
              <PropertiesPanel project={project} selection={selected ? selection : null} playhead={playhead} apply={apply} />
            </aside>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={t(playing ? 'editor.pause' : 'editor.play')} onClick={togglePlay}>
              <MorphIcon icon={playing ? PauseShape : PlayShape} />
            </Button>
            <span className="min-w-28 text-xs tabular-nums text-muted-foreground">
              {formatTime(playhead)} / {formatTime(length)}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.split')} disabled={!selected} onClick={split}>
              <ScissorsIcon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.delete')} disabled={!selected} onClick={remove}>
              <Trash2Icon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.undo')} disabled={!history.past.length} onClick={() => travel(undo)}>
              <Undo2Icon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.redo')} disabled={!history.future.length} onClick={() => travel(redo)}>
              <Redo2Icon />
            </Button>
            <span className="ml-auto min-w-0 truncate whitespace-nowrap text-xs text-muted-foreground">
              {t('editor.shortcuts')}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.zoom_out')} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}>
              <ZoomOutIcon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('editor.zoom_in')} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}>
              <ZoomInIcon />
            </Button>
            {exporting !== null ? (
              <div className="ml-2 flex items-center gap-2">
                <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                <Progress value={Math.round(exporting * 100)} className="w-28" aria-label={t('editor.exporting')} />
                <span className="w-9 text-xs tabular-nums text-muted-foreground">{Math.round(exporting * 100)}%</span>
                <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
                  {t('editor.cancel')}
                </Button>
              </div>
            ) : (
              <Button size="sm" className="ml-2" disabled={!!problem} onClick={() => void exportVideo()}>
                <DownloadIcon />
                {t('editor.export')}
              </Button>
            )}
          </div>
          <div className="flex h-64 min-h-40 shrink-0 flex-col">
            <EditorTimeline
              project={project}
              selection={selection}
              playhead={playhead}
              pixelsPerSecond={zoom}
              onZoom={(next) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)))}
              edits={{
                select: setSelection,
                seek,
                move: (ref, seconds, trackId) =>
                  applySelecting((current) => moveElement(current, ref, seconds, trackId)),
                trim: (ref, edge, seconds) => apply((current) => trimElement(current, ref, edge, seconds)),
                toggleTrack: (trackId, flag, value) => apply((current) => setTrackFlag(current, trackId, flag, value)),
              }}
            />
          </div>
          {usedMissing && <p className="text-xs text-destructive">{t('editor.problem_missing')}</p>}
          {project.tracks.main.elements.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('editor.empty_hint')}</p>
          )}
        </main>
      </div>
    </div>
  );
}
