import { mkdirSync, mkdtempSync, openAsBlob, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockedAttempt } from './promo-network-guard';
import type { WorkerReply, WorkerRequest } from './promo-render-worker';
import {
  assetsFontUri,
  logoDataUri,
  sceneDocument,
  sceneMediaIds,
  type PromoScene,
  type SceneFrame,
} from './promo-scenes';
import {
  writeTemplateProject,
  type PromoTemplateInput,
  type TemplateLogo,
} from './promo-templates';

/**
 * Renders an animated template to a transparent WebM in a utility process,
 * then stores it with the backend's promo media so `/promo/render` can lay it
 * over the shots. The temp project, the HOME the producer sees and the
 * output all live in one folder that is removed afterwards, so nothing the
 * producer caches can leak between renders or mask a missing font.
 */

export interface RenderChild {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (message: WorkerReply) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface PromoRenderDeps {
  baseUrl: string;
  headers: Record<string, string>;
  chromePath: string;
  /** The backend's `assets` folder (bundled fonts). */
  assetsDir: string;
  tempRoot: string;
  spawn: (env: Record<string, string>) => RenderChild;
  fetchImpl?: typeof fetch;
}

export interface PromoMediaResult {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  url: string;
}

export class PromoRenderError extends Error {
  readonly code: string;
  readonly blocked: BlockedAttempt[];

  constructor(code: string, detail?: string, blocked: BlockedAttempt[] = []) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.blocked = blocked;
  }
}

type ToolStatus = { ok?: boolean; path?: string | null };

async function mediaTools(deps: PromoRenderDeps) {
  const fetcher = deps.fetchImpl ?? fetch;
  const res = await fetcher(`${deps.baseUrl}/media-tools/status`, { headers: deps.headers });
  if (!res.ok) throw new PromoRenderError('ffmpeg_unavailable', `status ${res.status}`);
  const body = (await res.json()) as { tools?: Record<string, ToolStatus> };
  const ffmpeg = body.tools?.ffmpeg;
  const ffprobe = body.tools?.ffprobe;
  if (!ffmpeg?.ok || !ffmpeg.path || !ffprobe?.ok || !ffprobe.path) {
    throw new PromoRenderError('ffmpeg_unavailable');
  }
  return { ffmpeg: ffmpeg.path, ffprobe: ffprobe.path };
}

/** Environment for the render process: app Chrome, backend ffmpeg, private HOME and caches. */
export function workerEnvironment(
  base: NodeJS.ProcessEnv,
  paths: { chromePath: string; ffmpeg: string; ffprobe: string; sandbox: string },
): Record<string, string> {
  const home = join(paths.sandbox, 'home');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !/^(HYPERFRAMES_|PRODUCER_|PUPPETEER_)/.test(key)) env[key] = value;
  }
  // Proxy settings would route the guarded fetches around the loopback check.
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    HYPERFRAMES_EXTRACT_CACHE_DIR: join(paths.sandbox, 'extract'),
    PRODUCER_HEADLESS_SHELL_PATH: paths.chromePath,
    HYPERFRAMES_FFMPEG_PATH: paths.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: paths.ffprobe,
    PUPPETEER_SKIP_DOWNLOAD: '1',
  };
}

function runChild(
  child: RenderChild,
  request: WorkerRequest,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // A scene stuck in a loop must not hold the renderer forever.
    const timer = setTimeout(() => finish(new PromoRenderError('render_timeout')), timeoutMs);
    const finish = (error?: PromoRenderError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.kill();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      finish(new PromoRenderError('cancelled'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('message', (reply) => {
      if (reply.type === 'progress') onProgress(reply.progress);
      else if (reply.type === 'failed') {
        finish(new PromoRenderError('render_failed', reply.message, reply.blocked));
      } else if (reply.blocked.length) {
        // A blocked font or stylesheet still renders, with the wrong look.
        finish(new PromoRenderError('network_blocked', undefined, reply.blocked));
      } else finish();
    });
    child.on('exit', (code) => finish(new PromoRenderError('render_failed', `exit ${code}`)));
    child.postMessage(request);
  });
}

/** Largest logo the templates accept; promo uploads allow far more. */
export const MAX_LOGO_BYTES = 20 * 1024 * 1024;

/**
 * Reads a logo from the backend's promo media over loopback. The id was
 * checked against LOGO_ID, so it can name only a stored image.
 */
export async function fetchLogo(
  deps: Pick<PromoRenderDeps, 'baseUrl' | 'headers' | 'fetchImpl'>,
  logoId: string,
): Promise<TemplateLogo> {
  const res = await (deps.fetchImpl ?? fetch)(
    `${deps.baseUrl}/audio/promo_media/${encodeURIComponent(logoId)}`,
    { headers: deps.headers },
  );
  if (!res.ok) throw new PromoRenderError('logo_missing', `status ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_LOGO_BYTES) throw new PromoRenderError('logo_too_large');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new PromoRenderError('logo_too_large');
  return { bytes, extension: logoId.split('.').pop()! };
}

async function upload(
  deps: PromoRenderDeps,
  path: string,
  format: 'webm' | 'mp4',
): Promise<PromoMediaResult> {
  const form = new FormData();
  const name = format === 'mp4' ? 'scene.mp4' : 'overlay.webm';
  form.append('file', await openAsBlob(path, { type: `video/${format}` }), name);
  const res = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl}/promo/media`, {
    method: 'POST',
    headers: deps.headers,
    body: form,
  });
  if (!res.ok) throw new PromoRenderError('upload_failed', `status ${res.status}`);
  return (await res.json()) as PromoMediaResult;
}

export interface RenderOptions {
  fps: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

/** Longest a render may take: generous per frame, so only a stuck page hits it. */
export function renderTimeoutMs(duration: number, fps: number): number {
  return 120_000 + Math.ceil(duration * fps) * 500;
}

/**
 * Renders a project that `write` lays out in an empty folder, uploads the
 * result and removes every temporary file.
 */
async function renderProject(
  write: (projectDir: string) => Promise<void> | void,
  deps: PromoRenderDeps,
  options: RenderOptions & { format: 'webm' | 'mp4'; duration: number },
): Promise<PromoMediaResult> {
  const tools = await mediaTools(deps);
  mkdirSync(deps.tempRoot, { recursive: true });
  const sandbox = mkdtempSync(join(deps.tempRoot, 'render-'));
  try {
    const projectDir = join(sandbox, 'project');
    const outputPath = join(sandbox, `out.${options.format}`);
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    await write(projectDir);
    const child = deps.spawn(
      workerEnvironment(process.env, { ...tools, chromePath: deps.chromePath, sandbox }),
    );
    await runChild(
      child,
      { type: 'render', projectDir, outputPath, fps: options.fps, format: options.format },
      options.signal,
      options.onProgress ?? (() => {}),
      renderTimeoutMs(options.duration, options.fps),
    );
    return await upload(deps, outputPath, options.format);
  } finally {
    try {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
      // A file Chrome still holds on Windows must not turn a finished overlay
      // into an error; the OS temp cleanup removes the folder later.
      console.warn('[promo] could not remove render folder', error);
    }
  }
}

export async function renderPromoOverlay(
  input: PromoTemplateInput,
  deps: PromoRenderDeps,
  options: RenderOptions,
): Promise<PromoMediaResult> {
  return renderProject(
    async (projectDir) => {
      const logo = input.logoId ? await fetchLogo(deps, input.logoId) : undefined;
      writeTemplateProject(projectDir, input, deps.assetsDir, logo);
    },
    deps,
    { ...options, format: 'webm', duration: input.duration },
  );
}

/** Images the scene's params point at, as data URIs. */
export async function sceneImages(
  deps: Pick<PromoRenderDeps, 'baseUrl' | 'headers' | 'fetchImpl'>,
  scene: PromoScene,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (const id of sceneMediaIds(scene)) images.set(id, logoDataUri(await fetchLogo(deps, id)));
  return images;
}

/**
 * Renders a custom scene: a transparent WebM to lay over the shots, or an
 * opaque MP4 that is a shot of its own. The page is one self-contained file
 * (fonts and images inlined) under the scene's no-network policy.
 */
export async function renderPromoScene(
  scene: PromoScene,
  frame: SceneFrame & { mode: 'overlay' | 'shot' },
  deps: PromoRenderDeps,
  options: RenderOptions,
): Promise<PromoMediaResult> {
  return renderProject(
    async (projectDir) => {
      const images = await sceneImages(deps, scene);
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        join(projectDir, 'index.html'),
        sceneDocument(scene, {
          width: frame.width,
          height: frame.height,
          mode: 'render',
          fontUri: assetsFontUri(deps.assetsDir),
          images,
          backdrop: frame.mode === 'shot' ? '#000000' : undefined,
        }),
      );
    },
    deps,
    { ...options, format: frame.mode === 'shot' ? 'mp4' : 'webm', duration: scene.duration },
  );
}
