// @vitest-environment node
/**
 * Preview and render draw the same frames for every bundled motion library.
 *
 * Each sample scene is rendered by the real HyperFrames producer in Chrome
 * Headless Shell (offline flags and the network guard on, as in the app) to an
 * MP4, and the same page is opened in that Chrome and sought to the same times
 * the way the preview's clock does (`hf-seek`). Frames 0, the middle and the
 * last must match (PSNR, since the video is lossy).
 *
 * Needs Chrome Headless Shell and ffmpeg, so it runs only when they are found:
 * PROMO_CHROME_PATH (or the app's downloaded copy) and PROMO_FFMPEG_PATH (or
 * ffmpeg on PATH). Without them it is skipped, never faked.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME_OFFLINE_FLAGS, installChromeOfflineFlags, installNetworkGuard } from './promo-network-guard';
import { parseScene, sceneDocument, type PromoScene } from './promo-scenes';
import { packageDir } from './promo-scene-runtime';

// The sticker lives in the renderer, outside this project's tsconfig.
const { STAR_STICKER } = (await import(
  /* @vite-ignore */ join(process.cwd(), 'src/renderer/src/features/promo/lottie-stickers.ts')
)) as { STAR_STICKER: unknown };

function findChrome(): string | null {
  if (process.env.PROMO_CHROME_PATH) return process.env.PROMO_CHROME_PATH;
  const roots = [
    process.env.APPDATA && join(process.env.APPDATA, 'VoiceStudio'),
    join(homedir(), 'Library/Application Support/VoiceStudio'),
    join(homedir(), '.config/VoiceStudio'),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    const base = join(root, 'promo-browser', 'chrome-headless-shell');
    if (!existsSync(base)) continue;
    for (const version of readdirSync(base)) {
      for (const dir of readdirSync(join(base, version))) {
        for (const exe of ['chrome-headless-shell.exe', 'chrome-headless-shell']) {
          const path = join(base, version, dir, exe);
          if (existsSync(path)) return path;
        }
      }
    }
  }
  return null;
}

function findTool(name: 'ffmpeg' | 'ffprobe'): string | null {
  const env = process.env[`PROMO_${name.toUpperCase()}_PATH`];
  if (env) return env;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
  });
  return probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() || null : null;
}

const chromePath = findChrome();
const ffmpeg = findTool('ffmpeg');
const ffprobe = findTool('ffprobe');
const ready = Boolean(chromePath && ffmpeg && ffprobe);

const FPS = 30;
const DURATION = 2;
const WIDTH = 360;
const HEIGHT = 640;
/** Frame 0, the middle and the last frame (index round(d·fps) − 1). */
const FRAMES = [0, Math.round((DURATION * FPS) / 2), Math.round(DURATION * FPS) - 1];

const scene = (name: string, html: string, css: string, js: string): PromoScene =>
  parseScene({ id: null, name, html, css, js, params: [], assets: [], duration: DURATION });

const BOX = `.box{position:absolute;left:40px;top:60px;width:120px;height:120px;border-radius:24px;background:#ff3366}`;

export const PARITY_SCENES: Record<string, PromoScene> = {
  motion: scene(
    'motion',
    '<div class="box" id="a"></div><div class="box" id="b" style="top:300px;background:#33ccff"></div>',
    BOX,
    `import { animate, spring } from "evoice:motion";
animate('#a', { x: [0, 180], rotate: [0, 90] }, { duration: 1.6, ease: 'easeInOut' });
animate('#b', { x: [0, 200], scale: [0.4, 1] }, { type: spring, stiffness: 120, damping: 9 });`,
  ),
  anime: scene(
    'anime',
    '<div class="row">' + 'ABCDE'.split('').map((c) => `<span class="ch">${c}</span>`).join('') + '</div>',
    `.row{position:absolute;left:30px;top:250px;display:flex;gap:12px}.ch{display:inline-block;width:48px;height:80px;background:#ffcc00;color:#000;font:700 48px sans-serif;text-align:center}`,
    `import { animate, stagger } from "evoice:anime";
animate('.ch', { y: [-120, 0], opacity: [0, 1], rotate: [45, 0], duration: 700, delay: stagger(150), ease: 'outBack' });`,
  ),
  lottie: scene(
    'lottie',
    '<canvas id="c" width="300" height="300" style="position:absolute;left:30px;top:170px;width:300px;height:300px"></canvas>',
    '',
    `import { DotLottie } from "evoice:lottie";
new DotLottie({ canvas: document.getElementById('c'), data: ${JSON.stringify(STAR_STICKER)}, loop: true });`,
  ),
};

let work: string;
let removeGuard: () => void = () => {};
let blocked: unknown[] = [];

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'promo-parity-'));
});
afterAll(() => {
  removeGuard();
  if (!process.env.PROMO_PARITY_KEEP) rmSync(work, { recursive: true, force: true });
  else console.log(`parity frames kept in ${work}`);
});

async function renderMp4(name: string, html: string): Promise<string> {
  const sandbox = join(work, name);
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'index.html'), html);
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    HYPERFRAMES_EXTRACT_CACHE_DIR: join(sandbox, 'extract'),
    PRODUCER_HEADLESS_SHELL_PATH: chromePath!,
    HYPERFRAMES_FFMPEG_PATH: ffmpeg!,
    HYPERFRAMES_FFPROBE_PATH: ffprobe!,
    PUPPETEER_SKIP_DOWNLOAD: '1',
  });
  const { createRenderJob, executeRenderJob } = await import('@hyperframes/producer');
  const job = createRenderJob({ fps: FPS, quality: 'standard', format: 'mp4' });
  const out = join(sandbox, 'out.mp4');
  await executeRenderJob(job, project, out, () => {});
  if (job.status !== 'complete') throw new Error(job.error ?? `render_${job.status}`);
  return out;
}

function videoFrame(video: string, index: number, target: string): void {
  execFileSync(ffmpeg!, [
    '-v',
    'error',
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${index})`,
    '-frames:v',
    '1',
    '-y',
    target,
  ]);
}

/** PSNR in dB between two images of one size (inf when identical). */
function psnr(a: string, b: string): number {
  const run = spawnSync(ffmpeg!, ['-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const match = /average:(inf|[\d.]+)/.exec(run.stderr);
  if (!match) throw new Error(run.stderr.slice(-400));
  return match[1] === 'inf' ? Infinity : Number(match[1]);
}

async function seekFrames(name: string, html: string): Promise<string[]> {
  // Puppeteer as the producer itself loads it.
  const from = (dir: string, name: string) => {
    const req = createRequire(realpathSync(join(dir, 'package.json')));
    const base = (req.resolve.paths(name) ?? []).find((path) => existsSync(join(path, name)));
    if (!base) throw new Error(`not found: ${name}`);
    return realpathSync(join(base, name));
  };
  const engineDir = from(packageDir('@hyperframes/producer'), '@hyperframes/engine');
  const engine = createRequire(join(engineDir, 'package.json'));
  const puppeteer = engine('puppeteer-core') as {
    launch: (o: unknown) => Promise<{
      newPage(): Promise<{
        setViewport(v: unknown): Promise<void>;
        goto(url: string, o: unknown): Promise<unknown>;
        evaluate<T>(fn: (t: number) => T | Promise<T>, t: number): Promise<T>;
        screenshot(o: unknown): Promise<unknown>;
      }>;
      close(): Promise<void>;
    }>;
  };
  const dir = join(work, name);
  writeFileSync(join(dir, 'seek.html'), html);
  const browser = await puppeteer.launch({
    executablePath: chromePath!,
    headless: true,
    args: [...CHROME_OFFLINE_FLAGS, '--force-device-scale-factor=1', '--use-gl=swiftshader'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(`file://${join(dir, 'seek.html').replace(/\\/g, '/')}`, {
      waitUntil: 'load',
    });
    const shots: string[] = [];
    for (const index of FRAMES) {
      await page.evaluate(async (time) => {
        const pending: Promise<unknown>[] = [];
        dispatchEvent(
          new CustomEvent('hf-seek', { detail: { time, waitUntil: (p: Promise<unknown>) => pending.push(p) } }),
        );
        await Promise.all(pending);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, index / FPS);
      const path = join(dir, `seek-${index}.png`);
      await page.screenshot({ path, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      shots.push(path);
    }
    return shots;
  } finally {
    await browser.close();
  }
}

describe.skipIf(!ready)('preview and render match frame for frame', () => {
  beforeAll(() => {
    removeGuard = (() => {
      const guard = installNetworkGuard((attempt) => blocked.push(attempt));
      const flags = installChromeOfflineFlags(chromePath!);
      return () => {
        guard();
        flags.remove();
      };
    })();
  });

  it.each(Object.keys(PARITY_SCENES))(
    '%s: frames 0, middle and last',
    async (name) => {
      blocked = [];
      const doc = (mode: 'preview' | 'render') =>
        sceneDocument(PARITY_SCENES[name], {
          width: WIDTH,
          height: HEIGHT,
          mode,
          fontUri: () => 'data:font/ttf;base64,AA==',
          images: new Map(),
          backdrop: '#000000',
        });
      const video = process.env.PROMO_PARITY_REUSE && existsSync(join(work, name, 'out.mp4')) ? join(work, name, 'out.mp4') : await renderMp4(name, doc('render'));
      const seeks = await seekFrames(name, doc('render'));
      const scores: number[] = [];
      FRAMES.forEach((index, i) => {
        const target = join(dirname(video), `video-${index}.png`);
        videoFrame(video, index, target);
        scores.push(psnr(target, seeks[i]));
      });
      // Frame 0 and the middle differ, so a scene that never moved (or drew
      // nothing) cannot pass. The last frame may loop back to the first.
      expect(psnr(seeks[0], seeks[1])).toBeLessThan(30);
      for (const score of scores) expect(score).toBeGreaterThan(30);
      expect(blocked).toEqual([]);
    },
    240_000,
  );
});
