/**
 * Spike: does OpenCut's renderer (vendored, MIT) run inside eVoice Studio?
 *
 * Builds a two-track scene (a clip on the main track, a title on an overlay
 * track), previews it at the playhead and exports it with the same renderer.
 * `window.__opencutLab` drives the measurements from a script: encoder support,
 * preview-versus-export pixel difference, export time and memory.
 */
import { useEffect, useRef, useState } from 'react';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { apiPath } from '@/lib/api/client';
import { buildScene } from './vendor/services/renderer/scene-builder';
import { CanvasRenderer } from './vendor/services/renderer/canvas-renderer';
import { SceneExporter } from './vendor/services/renderer/scene-exporter';
import { initializeGpuRenderer, isGpuAvailable } from './vendor/services/renderer/gpu-renderer';
import { buildDefaultParamValues, getBuiltInElementParams } from './vendor/params/registry';
import { ZERO_MEDIA_TIME, mediaTimeFromSeconds, type MediaTime } from './vendor/wasm';
import type { SceneTracks, TextElement, VideoElement } from './vendor/timeline/types';
import type { MediaAsset } from './vendor/media/types';
import type { RootNode } from './vendor/services/renderer/nodes/root-node';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = { numerator: 30, denominator: 1 };
const seconds = (value: number): MediaTime => mediaTimeFromSeconds({ seconds: value });

async function probeDuration(url: string): Promise<{ duration: number; width: number; height: number }> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Cannot read the clip'));
  });
  return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
}

async function buildLabScene(file: File, clipSeconds: number) {
  await initializeGpuRenderer();
  const url = URL.createObjectURL(file);
  const meta = await probeDuration(url);
  const length = Math.min(clipSeconds, meta.duration);
  const asset: MediaAsset = {
    id: 'clip',
    name: file.name,
    type: 'video',
    file,
    url,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
  };
  const clip: VideoElement = {
    id: 'clip-1',
    name: file.name,
    type: 'video',
    mediaId: asset.id,
    startTime: ZERO_MEDIA_TIME,
    duration: seconds(length),
    trimStart: ZERO_MEDIA_TIME,
    trimEnd: seconds(Math.max(0, meta.duration - length)),
    sourceDuration: seconds(meta.duration),
    params: buildDefaultParamValues(getBuiltInElementParams({ type: 'video' })),
  };
  const title: TextElement = {
    id: 'title-1',
    name: 'Title',
    type: 'text',
    startTime: seconds(1),
    duration: seconds(Math.max(1, length - 2)),
    trimStart: ZERO_MEDIA_TIME,
    trimEnd: ZERO_MEDIA_TIME,
    params: {
      ...buildDefaultParamValues(getBuiltInElementParams({ type: 'text' })),
      content: 'eVoice Studio',
      fontSize: 12,
      color: '#ffffff',
    },
  };
  const tracks: SceneTracks = {
    main: { id: 'main', name: 'Main', type: 'video', elements: [clip], muted: false, hidden: false },
    overlay: [{ id: 'titles', name: 'Titles', type: 'text', elements: [title], hidden: false }],
    audio: [],
  };
  const root = buildScene({
    canvasSize: { width: WIDTH, height: HEIGHT },
    tracks,
    mediaAssets: [asset],
    duration: seconds(length),
    background: { type: 'color', color: '#000000' },
  });
  return { root, length };
}

function pixels(canvas: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const surface = new OffscreenCanvas(width, height);
  const context = surface.getContext('2d')!;
  context.drawImage(canvas, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

/** Mean absolute difference per channel (0–255) and the share of pixels off by more than 16. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let total = 0;
  let off = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    total += d;
    if (d > 16) off += 1;
  }
  const count = a.length / 4;
  return { mean: Number((total / count).toFixed(2)), offShare: Number((off / count).toFixed(4)) };
}

async function encoderSupport() {
  const configs = {
    avc: { codec: 'avc1.640028', width: WIDTH, height: HEIGHT, bitrate: 8_000_000, framerate: 30 },
    vp9: { codec: 'vp09.00.40.08', width: WIDTH, height: HEIGHT, bitrate: 8_000_000, framerate: 30 },
    aac: null,
  } as const;
  const result: Record<string, boolean | string> = {};
  for (const [name, config] of Object.entries(configs)) {
    if (!config) continue;
    try {
      result[name] = (await VideoEncoder.isConfigSupported(config)).supported ?? false;
    } catch (error) {
      result[name] = String(error);
    }
  }
  try {
    result.aac =
      (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }))
        .supported ?? false;
  } catch (error) {
    result.aac = String(error);
  }
  return result;
}

interface Lab {
  root: RootNode;
  length: number;
}

declare global {
  interface Window {
    __opencutLab?: Record<string, (...args: never[]) => Promise<unknown>>;
  }
}

export function OpencutLabPage() {
  const preview = useRef<HTMLCanvasElement>(null);
  const lab = useRef<Lab | null>(null);
  const [status, setStatus] = useState('Pick a clip');
  const [at, setAt] = useState(0);

  const load = async (file: File) => {
    setStatus('Building scene…');
    lab.current = await buildLabScene(file, 6);
    setStatus(`Scene ready: ${lab.current.length.toFixed(2)} s`);
    await draw(0);
  };

  const draw = async (time: number) => {
    if (!lab.current || !preview.current) return;
    const renderer = new CanvasRenderer({ width: WIDTH, height: HEIGHT, fps: FPS });
    await renderer.renderToCanvas({ node: lab.current.root, time: seconds(time), targetCanvas: preview.current });
  };

  const exportVideo = async (format: 'mp4' | 'webm') => {
    if (!lab.current) throw new Error('No scene');
    const exporter = new SceneExporter({ width: WIDTH, height: HEIGHT, fps: FPS, format, quality: 'high' });
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const before = memory?.usedJSHeapSize ?? 0;
    let peak = before;
    const watch = setInterval(() => {
      peak = Math.max(peak, memory?.usedJSHeapSize ?? 0);
    }, 100);
    const started = performance.now();
    const buffer = await exporter.export({ rootNode: lab.current.root });
    clearInterval(watch);
    if (!buffer) throw new Error('Export returned nothing');
    return {
      buffer,
      ms: Math.round(performance.now() - started),
      bytes: buffer.byteLength,
      heapGrowthMb: Math.round((peak - before) / 2 ** 20),
    };
  };

  useEffect(() => {
    window.__opencutLab = {
      encoderSupport,
      gpu: async () => {
        await initializeGpuRenderer();
        return isGpuAvailable();
      },
      loadUrl: async (url: string) => {
        const blob = await (await fetch(apiPath(url))).blob();
        await load(new File([blob], url.split('/').pop() ?? 'clip.mp4', { type: blob.type }));
        return lab.current?.length;
      },
      seekProbe: async (url: string, time: number) => {
        const blob = await (await fetch(apiPath(url))).blob();
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = (await input.getPrimaryVideoTrack())!;
        const sink = new CanvasSink(track);
        const first = (await sink.canvases(time).next()).value;
        const exact = await sink.getCanvas(time);
        return { iteratorFirst: first?.timestamp, getCanvas: exact?.timestamp };
      },
      previewAt: async (time: number) => {
        const renderer = new CanvasRenderer({ width: WIDTH, height: HEIGHT, fps: FPS });
        await renderer.render({ node: lab.current!.root, time: seconds(time) });
        const small = document.createElement('canvas');
        small.width = WIDTH / 4;
        small.height = HEIGHT / 4;
        small.getContext('2d')!.drawImage(renderer.getOutputCanvas(), 0, 0, small.width, small.height);
        return small.toDataURL('image/png');
      },
      exportAndCompare: async (format: 'mp4' | 'webm', times: number[]) => {
        const { buffer, ms, bytes, heapGrowthMb } = await exportVideo(format);
        const input = new Input({ source: new BlobSource(new Blob([buffer])), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('Exported file has no video track');
        const sink = new CanvasSink(track, { width: WIDTH, height: HEIGHT, fit: 'fill' });
        const frames = [];
        for (const time of times) {
          const renderer = new CanvasRenderer({ width: WIDTH, height: HEIGHT, fps: FPS });
          await renderer.render({ node: lab.current!.root, time: seconds(time) });
          const shown = pixels(renderer.getOutputCanvas(), WIDTH, HEIGHT);
          const decoded = await sink.getCanvas(time);
          if (!decoded) throw new Error(`No exported frame at ${time}s`);
          const exported = pixels(decoded.canvas as CanvasImageSource, WIDTH, HEIGHT);
          const thumb = (source: CanvasImageSource) => {
            const small = document.createElement('canvas');
            small.width = WIDTH / 4;
            small.height = HEIGHT / 4;
            small.getContext('2d')!.drawImage(source, 0, 0, small.width, small.height);
            return small.toDataURL('image/png');
          };
          frames.push({
            time,
            ...difference(shown, exported),
            preview: thumb(renderer.getOutputCanvas()),
            exported: thumb(decoded.canvas as CanvasImageSource),
          });
        }
        return {
          format,
          ms,
          bytes,
          heapGrowthMb,
          duration: await input.computeDuration(),
          codec: await track.getCodecParameterString(),
          frames,
        };
      },
    };
    return () => {
      delete window.__opencutLab;
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-5 text-sm">
      <h1 className="font-medium">OpenCut renderer lab (spike)</h1>
      <input
        type="file"
        accept="video/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
        }}
      />
      <p className="text-muted-foreground">{status}</p>
      <input
        type="range"
        min={0}
        max={lab.current?.length ?? 6}
        step={0.04}
        value={at}
        onChange={(event) => {
          const time = Number(event.target.value);
          setAt(time);
          void draw(time);
        }}
      />
      <canvas ref={preview} width={WIDTH / 4} height={HEIGHT / 4} className="rounded-lg bg-black" />
    </div>
  );
}
