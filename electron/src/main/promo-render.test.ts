// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLogo,
  MAX_LOGO_BYTES,
  PromoRenderError,
  renderPromoOverlay,
  renderPromoScene,
  renderTimeoutMs,
  workerEnvironment,
  type PromoRenderDeps,
  type RenderChild,
} from './promo-render';
import type { WorkerReply, WorkerRequest } from './promo-render-worker';
import { parseScene, SCENE_CSP } from './promo-scenes';
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
  for (const { source } of Object.values(TEMPLATE_FONTS)) {
    mkdirSync(join(root, 'assets', source, '..'), { recursive: true });
    writeFileSync(join(root, 'assets', source), 'font');
  }
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
    if (url.includes('/audio/promo_media/')) return new Response(new Uint8Array([137, 80, 78, 71]));
    return Response.json(media);
  });
  const value: PromoRenderDeps = {
    baseUrl: 'http://127.0.0.1:3900',
    headers: { 'X-Test': '1' },
    chromePath: '/app/promo-browser/shell',
    assetsDir: join(root, 'assets'),
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

describe('logos', () => {
  it('copies the logo into the project for a logo reveal', async () => {
    let project = '';
    const { value, fetchImpl } = deps((request, reply) => {
      project = request.projectDir;
      expect(readFileSync(join(project, 'logo.png'))).toEqual(Buffer.from([137, 80, 78, 71]));
      expect(readFileSync(join(project, 'index.html'), 'utf8')).toContain('src="logo.png"');
      writeFileSync(request.outputPath, 'webm');
      reply({ type: 'done', blocked: [] });
    });
    const reveal = parseTemplateInput({
      template: 'logo_reveal',
      title: '',
      subtitle: '',
      logoId: '0123456789abcdef.png',
      color: '#ffffff',
      glow: '#ffd400',
      duration: 3,
      width: 1080,
      height: 1080,
    });
    await renderPromoOverlay(reveal, value, { fps: 30 });
    expect(project).not.toBe('');
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'http://127.0.0.1:3900/audio/promo_media/0123456789abcdef.png',
    );
  });

  it('refuses a logo larger than the cap', async () => {
    const big = vi.fn(
      async () => new Response('x', { headers: { 'content-length': String(MAX_LOGO_BYTES + 1) } }),
    );
    await expect(
      fetchLogo(
        { baseUrl: 'http://127.0.0.1:1', headers: {}, fetchImpl: big as unknown as typeof fetch },
        '0123456789abcdef.png',
      ),
    ).rejects.toMatchObject({ code: 'logo_too_large' });
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

describe('renderPromoScene', () => {
  const scene = parseScene({
    id: null,
    name: 'Intro',
    html: '<h1>{{title}}</h1><img src="{{logo}}">',
    css: 'h1{font-family:"Oswald"}',
    js: '',
    params: [
      { key: 'title', type: 'text', label: 'Title', value: 'Hi' },
      { key: 'logo', type: 'image', label: 'Logo', value: '0123456789abcdef.png' },
    ],
    assets: [],
    duration: 4,
  });

  it('renders a shot as an opaque MP4 from one self-contained page', async () => {
    let page = '';
    let format: string | undefined;
    const { value, fetchImpl } = deps((request, reply) => {
      page = readFileSync(join(request.projectDir, 'index.html'), 'utf8');
      format = request.format;
      expect(readdirSync(request.projectDir)).toEqual(['index.html']);
      writeFileSync(request.outputPath, 'mp4');
      reply({ type: 'done', blocked: [] });
    });
    await renderPromoScene(scene, { width: 1080, height: 1920, mode: 'shot' }, value, { fps: 30 });
    expect(format).toBe('mp4');
    expect(page).toContain(`content="${SCENE_CSP}"`);
    expect(page).toContain('<h1>Hi</h1>');
    // Where the scene paints nothing, a shot is black, not the producer's white.
    expect(page).toContain('background:#000000');
    // The logo and the font are inlined; the page loads nothing.
    expect(page).toContain('src="data:image/png;base64,');
    expect(page).toContain('src:url("data:font/ttf;base64,');
    const upload = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(((upload[1].body as FormData).get('file') as File).name).toBe('scene.mp4');
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });

  it('renders an overlay as a transparent WebM', async () => {
    let format: string | undefined;
    const { value } = deps((request, reply) => {
      format = request.format;
      writeFileSync(request.outputPath, 'webm');
      reply({ type: 'done', blocked: [] });
    });
    let page = '';
    const second = deps((request, reply) => {
      page = readFileSync(join(request.projectDir, 'index.html'), 'utf8');
      writeFileSync(request.outputPath, 'webm');
      reply({ type: 'done', blocked: [] });
    });
    await renderPromoScene(scene, { width: 640, height: 360, mode: 'overlay' }, value, { fps: 30 });
    expect(format).toBe('webm');
    await renderPromoScene(scene, { width: 640, height: 360, mode: 'overlay' }, second.value, {
      fps: 30,
    });
    expect(page).toContain('background:transparent');
  });

  it('kills a render that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { value, child } = deps(() => {});
      const pending = renderPromoScene(scene, { width: 640, height: 360, mode: 'overlay' }, value, {
        fps: 30,
      }).catch((e) => e);
      await vi.waitFor(() => expect(child.env.PRODUCER_HEADLESS_SHELL_PATH).toBeTruthy());
      await vi.advanceTimersByTimeAsync(renderTimeoutMs(4, 30) + 1);
      expect(await pending).toMatchObject({ code: 'render_timeout' });
      expect(child.killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
