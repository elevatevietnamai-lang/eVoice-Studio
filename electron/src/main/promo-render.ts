import { mkdirSync, mkdtempSync, openAsBlob, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockedAttempt } from './promo-network-guard';
import type { WorkerReply, WorkerRequest } from './promo-render-worker';
import { writeTemplateProject, type PromoTemplateInput } from './promo-templates';

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
  fontsDir: string;
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: PromoRenderError) => {
      if (settled) return;
      settled = true;
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

async function upload(deps: PromoRenderDeps, path: string): Promise<PromoMediaResult> {
  const form = new FormData();
  form.append('file', await openAsBlob(path, { type: 'video/webm' }), 'overlay.webm');
  const res = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl}/promo/media`, {
    method: 'POST',
    headers: deps.headers,
    body: form,
  });
  if (!res.ok) throw new PromoRenderError('upload_failed', `status ${res.status}`);
  return (await res.json()) as PromoMediaResult;
}

export async function renderPromoOverlay(
  input: PromoTemplateInput,
  deps: PromoRenderDeps,
  options: { fps: number; signal?: AbortSignal; onProgress?: (progress: number) => void },
): Promise<PromoMediaResult> {
  const tools = await mediaTools(deps);
  mkdirSync(deps.tempRoot, { recursive: true });
  const sandbox = mkdtempSync(join(deps.tempRoot, 'render-'));
  try {
    const projectDir = join(sandbox, 'project');
    const outputPath = join(sandbox, 'overlay.webm');
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    writeTemplateProject(projectDir, input, deps.fontsDir);
    const child = deps.spawn(
      workerEnvironment(process.env, { ...tools, chromePath: deps.chromePath, sandbox }),
    );
    await runChild(
      child,
      { type: 'render', projectDir, outputPath, fps: options.fps },
      options.signal,
      options.onProgress ?? (() => {}),
    );
    return await upload(deps, outputPath);
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
