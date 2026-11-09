import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ProxyAgent } from 'proxy-agent';
import { renameWithRetry } from './rename-retry';
import { setupProxyForUrl } from './runtime-download';

/**
 * Resumable download of the one wheel `uv` cannot fetch reliably: PyTorch's CUDA build is ~3 GB, and
 * `uv` restarts a broken transfer from byte 0 on every retry. The wheel is chosen from `uv.lock`
 * (so URL and SHA-256 are the locked ones), fetched here with HTTP Range, verified, and then
 * installed from the local file so the ordinary frozen sync finds it already satisfied.
 */

export interface LockedWheel {
  name: string;
  version: string;
  filename: string;
  url: string;
  sha256: string;
}

const CUDA_INDEX = /^https:\/\/download\.pytorch\.org\/whl\/cu\d+/;

function wheelPlatformTag(platform: NodeJS.Platform, arch: string): RegExp | null {
  // Windows on ARM runs the x64 interpreter, so it uses the win_amd64 wheel as well.
  if (platform === 'win32') return /-cp311-cp311-win_amd64\.whl$/;
  if (platform === 'linux' && arch === 'x64') return /-cp311-cp311-manylinux_[0-9_]+_x86_64\.whl$/;
  return null;
}

/** The locked CUDA wheel for this host, or null when the lock has none (CPU, macOS, Linux ARM). */
export function findLockedCudaWheel(
  lock: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): LockedWheel | null {
  const tag = wheelPlatformTag(platform, arch);
  if (!tag) return null;
  for (const block of lock.replace(/\r\n/g, '\n').split('\n[[package]]\n')) {
    const head = /^name = "([^"]+)"\nversion = "([^"]+)"\nsource = \{ registry = "([^"]+)" \}/m.exec(
      block,
    );
    if (!head || head[1] !== name || !CUDA_INDEX.test(head[3])) continue;
    for (const match of block.matchAll(/\{ url = "([^"]+)", hash = "sha256:([0-9a-f]{64})"/g)) {
      const filename = decodeURIComponent(match[1].split('/').pop() ?? '');
      if (tag.test(filename)) {
        return { name, version: head[2], filename, url: match[1], sha256: match[2] };
      }
    }
  }
  return null;
}

class TransientError extends Error {}

const STALL_MS = 60_000;
const MAX_ATTEMPTS = 80;
const MAX_IDLE_ATTEMPTS = 8;

export interface WheelDownloadOptions {
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  log?: (line: string) => void;
  /** Test hook: pause between attempts. */
  backoffMs?: number;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function sizeOf(path: string): Promise<number> {
  return stat(path).then(
    (info) => info.size,
    () => 0,
  );
}

function isLoopback(url: URL): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

function open(
  target: string,
  have: number,
  agent: ProxyAgent,
  signal: AbortSignal,
  redirects = 0,
): Promise<IncomingMessage> {
  const url = new URL(target);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
    return Promise.reject(new Error('Runtime wheels are only downloaded over HTTPS'));
  }
  const get = url.protocol === 'https:' ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const request = get(
      target,
      {
        ...(url.protocol === 'https:' ? { agent } : {}),
        signal,
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          if (!response.headers.location || redirects >= 5) {
            reject(new Error('Runtime wheel redirect limit exceeded'));
            return;
          }
          open(new URL(response.headers.location, target).href, have, agent, signal, redirects + 1)
            .then(resolve, reject);
          return;
        }
        resolve(response);
      },
    );
    request.on('error', reject);
  });
}

/** Total size from `Content-Range: bytes a-b/total` or, for a full response, `Content-Length`. */
function totalFrom(response: IncomingMessage, have: number): number {
  const range = /\/(\d+)$/.exec(String(response.headers['content-range'] ?? ''));
  if (range) return Number(range[1]);
  const length = Number(response.headers['content-length'] ?? 0);
  return length > 0 ? have + length : 0;
}

/**
 * Download `wheel` into `dir`, resuming a partial file across failed attempts and restarts of the
 * app, and verify its SHA-256 against the lock. Returns the final path.
 */
export async function downloadLockedWheel(
  wheel: LockedWheel,
  dir: string,
  { env, signal, log = () => {}, backoffMs = 1_000 }: WheelDownloadOptions,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const part = join(dir, `${wheel.filename}.part`);
  const final = join(dir, wheel.filename);
  if ((await sizeOf(final)) > 0 && (await sha256Of(final)) === wheel.sha256) return final;
  await rm(final, { force: true });

  const agent = new ProxyAgent({ getProxyForUrl: (target) => setupProxyForUrl(target, env) });
  try {
    let verifiedOnce = false;
    for (;;) {
      await fetchWithResume(wheel, part, agent, signal, log, backoffMs);
      if ((await sha256Of(part)) === wheel.sha256) break;
      await rm(part, { force: true });
      if (verifiedOnce) throw new Error(`The downloaded ${wheel.filename} does not match its locked hash.`);
      verifiedOnce = true;
      log(`${wheel.filename} failed its checksum; downloading it again.`);
    }
    await renameWithRetry(part, final);
    return final;
  } finally {
    agent.destroy();
  }
}

async function fetchWithResume(
  wheel: LockedWheel,
  part: string,
  agent: ProxyAgent,
  signal: AbortSignal,
  log: (line: string) => void,
  backoffMs: number,
): Promise<void> {
  let idle = 0;
  let announced = -1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    signal.throwIfAborted();
    const have = await sizeOf(part);
    let total = 0;
    try {
      const response = await open(wheel.url, have, agent, signal);
      const status = response.statusCode ?? 0;
      if (status === 416) {
        // The partial file already covers everything the server has, or is stale: let the hash decide.
        response.resume();
        return;
      }
      if (status !== 200 && status !== 206) {
        response.resume();
        const message = `Runtime wheel download failed (${status})`;
        throw status >= 500 || status === 429 ? new TransientError(message) : new Error(message);
      }
      // A server that ignores Range answers 200 with the whole file: start over.
      const resumed = status === 206 && have > 0;
      if (!resumed) await rm(part, { force: true });
      const offset = resumed ? have : 0;
      total = totalFrom(response, offset);
      if (offset > 0) log(`Resuming ${wheel.filename} at ${Math.round(offset / 1024 ** 2)} MiB.`);
      let received = offset;
      const stall = setInterval(() => response.destroy(new TransientError('stalled')), STALL_MS);
      stall.unref();
      response.on('data', (chunk: Buffer) => {
        stall.refresh();
        received += chunk.length;
        const percent = total > 0 ? Math.floor((received / total) * 100) : -1;
        if (percent >= 0 && percent >= announced + 5) {
          announced = percent;
          log(`Downloading ${wheel.filename}: ${percent}% (${Math.round(received / 1024 ** 2)} MiB)`);
        }
      });
      try {
        await pipeline(response, createWriteStream(part, { flags: resumed ? 'a' : 'w' }));
      } finally {
        clearInterval(stall);
      }
      if (total === 0 || (await sizeOf(part)) >= total) return;
      throw new TransientError('connection closed early');
    } catch (error) {
      signal.throwIfAborted();
      if (!isTransient(error)) throw error;
      idle = (await sizeOf(part)) > have ? 0 : idle + 1;
      if (idle >= MAX_IDLE_ATTEMPTS) {
        throw new Error(
          `The connection keeps dropping while downloading ${wheel.filename}. ` +
            'Check the network, then retry: the download continues from where it stopped.',
        );
      }
      log(`Download interrupted (${(error as Error).message}); retrying.`);
      await pause(backoffMs * Math.min(attempt, 10), signal);
    }
  }
  throw new Error(`Could not finish downloading ${wheel.filename}.`);
}

function isTransient(error: unknown): boolean {
  if (error instanceof TransientError) return true;
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? '';
  const name = (error as Error | undefined)?.name;
  return (
    name === 'TimeoutError' ||
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
      'ECONNABORTED',
      'ERR_STREAM_PREMATURE_CLOSE',
    ].includes(code)
  );
}
