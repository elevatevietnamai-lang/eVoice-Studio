/**
 * Runs the editor on OpenCut's renderer: fetches the uploaded files, builds
 * the scene, plays the preview with sound and exports the video. Preview and
 * export draw with the same renderer, so the preview shows the exported frames.
 */
import { apiPath } from '@/lib/api/client';
import { buildScene } from '@/lib/opencut/vendor/services/renderer/scene-builder';
import { CanvasRenderer } from '@/lib/opencut/vendor/services/renderer/canvas-renderer';
import { SceneExporter } from '@/lib/opencut/vendor/services/renderer/scene-exporter';
import { initializeGpuRenderer } from '@/lib/opencut/vendor/services/renderer/gpu-renderer';
import type { RootNode } from '@/lib/opencut/vendor/services/renderer/nodes/root-node';
import type { MediaAsset } from '@/lib/opencut/vendor/media/types';
import type { SceneTracks } from '@/lib/opencut/vendor/timeline/types';
import { ColorNode } from '@/lib/opencut/vendor/services/renderer/nodes/color-node';
import type { AnyBaseNode } from '@/lib/opencut/vendor/services/renderer/nodes/base-node';
import {
  MAX_EXPORT_SECONDS,
  SHAPE_SIZE,
  projectSeconds,
  ticks,
  type EditorMedia,
  type EditorProject,
} from './project';
import { audioSegments, scheduleSegments, soundActivity, type AudioSegment } from './audio-mix';
import { TEXT_FONTS } from './timeline-ops';
import { mainForRender, placedTransitions, shadeOpacity } from './transitions';

export const SAMPLE_RATE = 48_000;

const files = new Map<string, Promise<File>>();
const objectUrls = new Map<string, string>();
const decoded = new Map<string, Promise<AudioBuffer | null>>();
let audioContext: AudioContext | null = null;
let ready: Promise<void> | null = null;

/** The one AudioContext for decoding and the preview. */
export function sharedAudioContext(): AudioContext {
  audioContext ??= new AudioContext({ sampleRate: SAMPLE_RATE });
  return audioContext;
}

/** GPU compositor plus the local fonts text uses, before anything is drawn. */
export function ensureEngine(): Promise<void> {
  ready ??= (async () => {
    await initializeGpuRenderer();
    await Promise.all(
      TEXT_FONTS.flatMap((family) => [
        document.fonts.load(`48px "${family}"`),
        document.fonts.load(`bold 48px "${family}"`),
      ]),
    );
  })();
  return ready;
}

export function mediaFile(media: EditorMedia): Promise<File> {
  let file = files.get(media.id);
  if (!file) {
    file = fetch(apiPath(media.url)).then(async (response) => {
      if (!response.ok) throw new Error(`${media.name}: ${response.status}`);
      const blob = await response.blob();
      return new File([blob], media.name, { type: blob.type });
    });
    file.catch(() => files.delete(media.id));
    files.set(media.id, file);
  }
  return file;
}

function decodedAudio(media: EditorMedia): Promise<AudioBuffer | null> {
  let buffer = decoded.get(media.id);
  if (!buffer) {
    buffer = mediaFile(media)
      .then(async (file) => sharedAudioContext().decodeAudioData(await file.arrayBuffer()))
      .catch(() => null);
    decoded.set(media.id, buffer);
  }
  return buffer;
}

const peakCache = new Map<string, Promise<Float32Array | null>>();
/** Waveform resolution: peak levels per second of source. */
export const PEAKS_PER_SECOND = 50;

/** Loudest sample per 1/50 s of the file (0..1), for drawing its waveform. */
export function mediaPeaks(media: EditorMedia): Promise<Float32Array | null> {
  let peaks = peakCache.get(media.id);
  if (!peaks) {
    peaks = decodedAudio(media).then((buffer) => {
      if (!buffer) return null;
      const size = Math.max(1, Math.ceil(buffer.duration * PEAKS_PER_SECOND));
      const out = new Float32Array(size);
      const step = buffer.length / size;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < size; i++) {
          let peak = out[i];
          const end = Math.min(data.length, Math.floor((i + 1) * step));
          for (let j = Math.floor(i * step); j < end; j += 4) peak = Math.max(peak, Math.abs(data[j]));
          out[i] = peak;
        }
      }
      return out;
    });
    peakCache.set(media.id, peaks);
  }
  return peaks;
}

export interface LoadedMedia {
  assets: MediaAsset[];
  buffers: Map<string, AudioBuffer | null>;
  segments: AudioSegment[];
  /** When any clip is ducked: whether something else is heard at a timeline second. */
  activity: ((t: number) => boolean) | null;
}

/** Fetches every file the project uses; a file that fails is left out of the scene. */
export async function loadMedia(project: EditorProject): Promise<LoadedMedia> {
  const segments = audioSegments(project);
  const used = new Set(
    [project.tracks.main, ...project.tracks.overlay].flatMap((track) =>
      track.elements.flatMap((element) => ('mediaId' in element ? [element.mediaId] : [])),
    ),
  );
  const assets: MediaAsset[] = [];
  await Promise.all(
    project.media
      .filter((media) => used.has(media.id) && media.kind !== 'audio')
      .map(async (media) => {
        try {
          const file = await mediaFile(media);
          let url = objectUrls.get(media.id);
          if (!url) {
            url = URL.createObjectURL(file);
            objectUrls.set(media.id, url);
          }
          assets.push({
            id: media.id,
            name: media.name,
            type: media.kind,
            file,
            url,
            width: media.width ?? undefined,
            height: media.height ?? undefined,
            duration: media.duration ?? undefined,
          });
        } catch {
          // A missing file is shown as missing by the page; the rest still renders.
        }
      }),
  );
  const buffers = new Map<string, AudioBuffer | null>();
  await Promise.all(
    [...new Set(segments.map((segment) => segment.mediaId))].map(async (id) => {
      const media = project.media.find((item) => item.id === id);
      buffers.set(id, media ? await decodedAudio(media) : null);
    }),
  );
  let activity: LoadedMedia['activity'] = null;
  if (segments.some((segment) => segment.duck)) {
    const peaks = new Map<string, Float32Array | null>();
    await Promise.all(
      [...new Set(segments.map((segment) => segment.mediaId))].map(async (id) => {
        const media = project.media.find((item) => item.id === id);
        peaks.set(id, media ? await mediaPeaks(media) : null);
      }),
    );
    activity = soundActivity(segments, peaks, PEAKS_PER_SECOND);
  }
  return { assets, buffers, segments, activity };
}

/** The black a fade through black passes through, over the main track. */
function shadeNodes(project: EditorProject): AnyBaseNode[] {
  return placedTransitions(project.tracks.main.elements)
    .filter((item) => item.type === 'black')
    .map(
      (item) =>
        new ColorNode({
          color: '#000000',
          opacityAt: (seconds) =>
            seconds < item.start || seconds >= item.start + item.seconds ? 0 : shadeOpacity((seconds - item.start) / item.seconds),
        }),
    );
}

export function buildEditorScene(project: EditorProject, assets: MediaAsset[], isPreview = false): RootNode {
  const canvasSize = SHAPE_SIZE[project.shape];
  const tracks: SceneTracks = {
    main: mainForRender(project.tracks.main, canvasSize.width),
    // Overlays are free tracks: one decoder per track and file.
    overlay: project.tracks.overlay.map((track) => ({
      ...track,
      elements: track.elements.map((element) =>
        'mediaId' in element ? { ...element, cacheKey: `${element.mediaId}#${track.id}` } : element,
      ),
    })) as SceneTracks['overlay'],
    audio: [],
  };
  return buildScene({
    canvasSize,
    tracks,
    mediaAssets: assets,
    duration: ticks(Math.max(projectSeconds(project), 0.04)),
    background: { type: 'color', color: project.background },
    isPreview,
    afterMain: project.tracks.main.hidden ? [] : shadeNodes(project),
  });
}

const frameRate = (fps: number) => ({ numerator: fps, denominator: 1 });

/**
 * Plays and seeks the preview. The clock is the AudioContext, so sound and
 * picture stay together, and a tick that arrives late skips frames rather
 * than drifting.
 */
export class EditorPlayer {
  private renderer: CanvasRenderer | null = null;
  private root: RootNode | null = null;
  private loaded: LoadedMedia | null = null;
  private length = 0;
  private drawing = false;
  private queued: number | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock: { position: number; at: number } | null = null;
  position = 0;

  constructor(
    private readonly target: () => HTMLCanvasElement | null,
    private readonly onTime: (seconds: number, playing: boolean) => void,
  ) {}

  get playing(): boolean {
    return this.clock !== null;
  }

  /** Swaps in an edited project; playback restarts from where it was. */
  async setProject(project: EditorProject): Promise<void> {
    await ensureEngine();
    const loaded = await loadMedia(project);
    const { width, height } = SHAPE_SIZE[project.shape];
    if (!this.renderer || this.renderer.width !== width || this.renderer.height !== height)
      this.renderer = new CanvasRenderer({ width, height, fps: frameRate(project.fps) });
    this.root = buildEditorScene(project, loaded.assets, true);
    this.loaded = loaded;
    this.length = projectSeconds(project);
    if (this.playing) {
      this.stopSound();
      this.startSound(this.currentPosition());
    }
    this.show(Math.min(this.position, this.length));
  }

  show(seconds: number): void {
    this.position = Math.max(0, seconds);
    this.queued = this.position;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      while (this.queued !== null) {
        const time = this.queued;
        this.queued = null;
        const canvas = this.target();
        if (!canvas || !this.renderer || !this.root) continue;
        await this.renderer.renderToCanvas({ node: this.root, time: ticks(time), targetCanvas: canvas });
      }
    } finally {
      this.drawing = false;
    }
  }

  private currentPosition(): number {
    if (!this.clock) return this.position;
    return this.clock.position + (sharedAudioContext().currentTime - this.clock.at);
  }

  private startSound(from: number): void {
    const context = sharedAudioContext();
    const when = context.currentTime + 0.05;
    this.clock = { position: from, at: when };
    this.sources = this.loaded ? scheduleSegments(context, this.loaded.segments, this.loaded.buffers, from, when, context.destination, this.loaded.activity) : [];
  }

  private stopSound(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources = [];
  }

  async play(): Promise<void> {
    if (this.playing || this.length <= 0) return;
    await sharedAudioContext().resume();
    const from = this.position >= this.length - 0.05 ? 0 : this.position;
    this.startSound(from);
    this.timer = setInterval(() => {
      const position = Math.max(0, this.currentPosition());
      if (position >= this.length) {
        this.pause();
        this.show(this.length);
        this.onTime(this.length, false);
        return;
      }
      this.show(position);
      this.onTime(position, true);
    }, 1000 / 60);
  }

  pause(): void {
    if (!this.playing) return;
    this.position = Math.min(this.length, Math.max(0, this.currentPosition()));
    this.clock = null;
    this.stopSound();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onTime(this.position, false);
  }

  dispose(): void {
    this.pause();
    this.root = null;
  }
}

/** 16-bit PCM WAV of one mono channel. */
function wav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

const SPEECH_SAMPLE_RATE = 16_000;

/**
 * The project's whole sound as a mono 16 kHz WAV, on the timeline's clock, so
 * transcribed timings land on the timeline as they are. Null when silent.
 */
export async function mixdownForSpeech(
  project: EditorProject,
): Promise<{ wav: Blob; voiced: { start: number; end: number } | null } | null> {
  const loaded = await loadMedia(project);
  const seconds = projectSeconds(project);
  if (!loaded.segments.length || seconds <= 0) return null;
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * SPEECH_SAMPLE_RATE), SPEECH_SAMPLE_RATE);
  scheduleSegments(offline, loaded.segments, loaded.buffers, 0, 0, offline.destination, loaded.activity);
  const samples = (await offline.startRendering()).getChannelData(0);
  return { wav: wav(samples, SPEECH_SAMPLE_RATE), voiced: voicedSpan(samples, SPEECH_SAMPLE_RATE) };
}

/** First and last moment (seconds) the sound is clearly above its quiet parts. */
export function voicedSpan(samples: Float32Array, sampleRate: number): { start: number; end: number } | null {
  const frame = Math.round(sampleRate * 0.02);
  const levels: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += samples[j] * samples[j];
    levels.push(Math.sqrt(sum / frame));
  }
  const loudest = Math.max(0, ...levels);
  if (loudest < 0.005) return null;
  const threshold = loudest * 0.1;
  const first = levels.findIndex((level) => level > threshold);
  const last = levels.length - 1 - [...levels].reverse().findIndex((level) => level > threshold);
  return { start: (first * frame) / sampleRate, end: ((last + 1) * frame) / sampleRate };
}

export type ExportProblem = 'empty' | 'too_long';

export function exportProblem(project: EditorProject): ExportProblem | null {
  const seconds = projectSeconds(project);
  if (seconds <= 0) return 'empty';
  if (seconds > MAX_EXPORT_SECONDS) return 'too_long';
  return null;
}

/** MP4 (H.264 + AAC) where the system has the encoder, otherwise WebM (VP9 + Opus). */
export async function exportFormat(project: EditorProject): Promise<'mp4' | 'webm'> {
  const { width, height } = SHAPE_SIZE[project.shape];
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640033',
      width,
      height,
      bitrate: 10_000_000,
      framerate: project.fps,
    });
    return supported ? 'mp4' : 'webm';
  } catch {
    return 'webm';
  }
}

/** Renders the project, sound mixed in, to a video file. Resolves null when cancelled. */
export async function exportProject(
  project: EditorProject,
  onProgress: (share: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; format: 'mp4' | 'webm' } | null> {
  const problem = exportProblem(project);
  if (problem) throw new Error(problem);
  await ensureEngine();
  const loaded = await loadMedia(project);
  const seconds = projectSeconds(project);
  let audioBuffer: AudioBuffer | undefined;
  if (loaded.segments.length) {
    const offline = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    scheduleSegments(offline, loaded.segments, loaded.buffers, 0, 0, offline.destination, loaded.activity);
    audioBuffer = await offline.startRendering();
  }
  const format = await exportFormat(project);
  const { width, height } = SHAPE_SIZE[project.shape];
  const exporter = new SceneExporter({
    width,
    height,
    fps: frameRate(project.fps),
    format,
    quality: 'high',
    shouldIncludeAudio: !!audioBuffer,
    audioBuffer,
  });
  exporter.on('progress', onProgress);
  const cancel = () => exporter.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const buffer = await exporter.export({ rootNode: buildEditorScene(project, loaded.assets) });
    if (!buffer) return null;
    return { blob: new Blob([buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' }), format };
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
