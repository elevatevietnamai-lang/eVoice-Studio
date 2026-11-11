// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PromoRenderError,
  renderPromoOverlay,
  workerEnvironment,
  type PromoRenderDeps,
  type RenderChild,
} from './promo-render';
import type { WorkerReply, WorkerRequest } from './promo-render-worker';
import { parseTemplateInput, TEMPLATE_FONTS } from './promo-templates';

const input = parseTemplateInput({
  template: 'glow_title',
  title: 'SALE',
  subtitle: '',
  color: '#ffffff',
  glow: '#ff0000',
  duration: 2,
  width: 720,
  height: 1280,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'promo-render-'));
  mkdirSync(join(root, 'fonts'));
  for (const { file } of TEMPLATE_FONTS) writeFileSync(join(root, 'fonts', file), 'font');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Script = (
  request: WorkerRequest,
  reply: (message: WorkerReply) => void,
  exit: (code: number) => void,
) => void;

function fakeChild(script: Script) {
  const listeners: { message?: (m: WorkerReply) => void; exit?: (c: number) => void } = {};
  const child = {
    killed: false,
    env: {} as Record<string, string>,
    on(event: 'message' | 'exit', listener: never) {
      listeners[event] = listener;
      return child;
    },
    postMessage(request: WorkerRequest) {
      queueMicrotask(() =>
        script(
          request,
          (message) => listeners.message?.(message),
          (code) => listeners.exit?.(code),
        ),
      );
    },
    kill() {
      child.killed = true;
      return true;
    },
  };
  return child;
}

const media = {
  id: 'abc.webm',
  kind: 'video',
  name: 'overlay.webm',
  duration: 2,
  width: 720,
  height: 1280,
  url: '/promo/media/abc.webm',
};

function deps(script: Script, statusBody: unknown = null) {
  const child = fakeChild(script);
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.endsWith('/media-tools/status')) {
      return Response.json(
        statusBody ?? {
          tools: {
            ffmpeg: { ok: true, path: '/bin/ffmpeg' },
            ffprobe: { ok: true, path: '/bin/ffprobe' },
          },
        },
      );
    }
    return Response.json(media);
  });
  const value: PromoRenderDeps = {
    baseUrl: 'http://127.0.0.1:3900',
    headers: { 'X-Test': '1' },
    chromePath: '/app/promo-browser/shell',
    fontsDir: join(root, 'fonts'),
    tempRoot: join(root, 'tmp'),
    spawn: (env) => {
      child.env = env;
      return child as unknown as RenderChild;
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { value, child, fetchImpl };
}

const writeOutput: Script = (request, reply) => {
  writeFileSync(request.outputPath, 'webm');
  reply({ type: 'progress', progress: 50 });
  reply({ type: 'done', blocked: [] });
};

describe('renderPromoOverlay', () => {
  it('renders in the worker, uploads the WebM and cleans up', async () => {
    const { value, child, fetchImpl } = deps(writeOutput);
    const progress: number[] = [];
    const result = await renderPromoOverlay(input, value, {
      fps: 30,
      onProgress: (p) => progress.push(p),
    });
    expect(result).toEqual(media);
    expect(progress).toEqual([50]);
    expect(child.killed).toBe(true);
    expect(child.env).toMatchObject({
      PRODUCER_HEADLESS_SHELL_PATH: '/app/promo-browser/shell',
      HYPERFRAMES_FFMPEG_PATH: '/bin/ffmpeg',
      HYPERFRAMES_FFPROBE_PATH: '/bin/ffprobe',
    });
    const upload = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(upload[0]).toBe('http://127.0.0.1:3900/promo/media');
    expect((upload[1].body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });

  it('fails a render that tried to reach the network, even if it finished', async () => {
    const { value, fetchImpl } = deps((request, reply) => {
      writeFileSync(request.outputPath, 'webm');
      reply({ type: 'done', blocked: [{ kind: 'fetch', target: 'fonts.googleapis.com' }] });
    });
    const error = await renderPromoOverlay(input, value, { fps: 30 }).catch((e) => e);
    expect(error).toBeInstanceOf(PromoRenderError);
    expect(error.code).toBe('network_blocked');
    expect(error.blocked).toEqual([{ kind: 'fetch', target: 'fonts.googleapis.com' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses when the backend has no ffmpeg', async () => {
    const { value } = deps(writeOutput, { tools: { ffmpeg: { ok: false, path: null } } });
    await expect(renderPromoOverlay(input, value, { fps: 30 })).rejects.toMatchObject({
      code: 'ffmpeg_unavailable',
    });
  });

  it('kills the worker and removes the temp folder on cancel', async () => {
    const controller = new AbortController();
    const { value, child } = deps(() => controller.abort());
    await expect(
      renderPromoOverlay(input, value, { fps: 30, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(child.killed).toBe(true);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });

  it('reports a worker that exits without answering', async () => {
    const { value } = deps((_request, _reply, exit) => exit(3));
    await expect(renderPromoOverlay(input, value, { fps: 30 })).rejects.toMatchObject({
      code: 'render_failed',
      message: 'render_failed: exit 3',
    });
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });
});

describe('workerEnvironment', () => {
  it('gives the producer a private HOME and drops proxy and override variables', () => {
    const env = workerEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        HTTPS_PROXY: 'http://proxy:8080',
        no_proxy: 'x',
        PRODUCER_HEADLESS_SHELL_PATH: '/home/me/.cache/puppeteer/shell',
        HYPERFRAMES_BROWSER_PATH: '/elsewhere',
      },
      { chromePath: '/app/shell', ffmpeg: '/f', ffprobe: '/p', sandbox: '/tmp/s' },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe(join('/tmp/s', 'home'));
    expect(env.USERPROFILE).toBe(env.HOME);
    expect(env.PRODUCER_HEADLESS_SHELL_PATH).toBe('/app/shell');
    expect(env.HYPERFRAMES_BROWSER_PATH).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
  });
});
