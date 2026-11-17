import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { GeminiAccountStatus, GeminiLoginStart, GeminiModel } from '../preload/index.d';

/**
 * Gemini through the user's Google account, via the Antigravity CLI (`agy`).
 * Nothing here runs until the user asks: the status check lists models from
 * Google, and the sign-in starts `agy acp --login`, which prints a Google link
 * and waits for the authorization code the user pastes back.
 */

export const GEMINI_STATUS_TIMEOUT_MS = 30_000;
export const GEMINI_LOGIN_TIMEOUT_MS = 10 * 60_000;
const MAX_CODE = 4_096;
const MAX_OUTPUT = 64_000;

export interface AgyCommand {
  executable: string;
  prefix: string[];
}

/** `agy models` prints `id<TAB>label` rows; only Gemini models are offered. */
export function parseGeminiModels(stdout: string): GeminiModel[] {
  const seen = new Set<string>();
  const models: GeminiModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [id, ...rest] = line.trim().split('\t');
    if (!/^gemini-[\w.-]+$/.test(id || '') || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: rest.join(' ').trim() || id });
  }
  return models;
}

const SIGNED_OUT =
  /not (?:logged|signed) in|log ?in required|sign ?in required|authentication required/i;

/**
 * Three states, never two: a network failure or timeout is "unknown", not
 * "signed out", so the app never tells a signed-in user to sign in again.
 */
export function geminiStatusFrom(run: {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  spawnFailed?: boolean;
}): Omit<GeminiAccountStatus, 'installed'> {
  if (run.spawnFailed || run.timedOut) return { state: 'unknown', models: [] };
  const models = parseGeminiModels(run.stdout);
  if (run.code === 0 && models.length) return { state: 'signedIn', models };
  if (SIGNED_OUT.test(run.stdout + '\n' + run.stderr)) return { state: 'signedOut', models: [] };
  // Signed out, agy lists nothing ("Auth mode is unspecified").
  if (run.code === 0 && !run.stdout.trim()) return { state: 'signedOut', models: [] };
  return { state: 'unknown', models: [] };
}

/** The sign-in link agy prints; only Google's own sign-in page is accepted. */
export function parseLoginUrl(text: string): string | null {
  for (const match of text.matchAll(/https:\/\/\S+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === 'https:' && url.hostname === 'accounts.google.com')
        return url.toString();
    } catch {
      // Not a URL.
    }
  }
  return null;
}

/** The authorization code, or the full redirect URL, as one line. */
export function validLoginCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  // Printable ASCII only: OAuth codes and callback URLs never contain spaces,
  // and a control character could end the line agy reads.
  if (!code || code.length > MAX_CODE || !/^[\x21-\x7e]+$/.test(code)) return null;
  return code;
}

interface Deps {
  locate: () => Promise<AgyCommand | null>;
  env: () => NodeJS.ProcessEnv;
  terminate: (child: ChildProcessWithoutNullStreams) => void;
  openExternal: (url: string) => Promise<void>;
  spawnProcess?: typeof spawn;
}

export function createGeminiAccount(deps: Deps) {
  const run = deps.spawnProcess ?? spawn;
  let statusRun: Promise<GeminiAccountStatus> | null = null;
  let login: {
    child: ChildProcessWithoutNullStreams;
    url: string | null;
    exited: Promise<number | null>;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  const spawnAgy = (command: AgyCommand, args: string[]) =>
    run(command.executable, [...command.prefix, ...args], {
      env: deps.env(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

  const checkStatus = async (): Promise<GeminiAccountStatus> => {
    const command = await deps.locate();
    if (!command) return { installed: false, state: 'unknown', models: [] };
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let done = false;
      let child: ChildProcessWithoutNullStreams;
      const finish = (result: Parameters<typeof geminiStatusFrom>[0]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ installed: true, ...geminiStatusFrom(result) });
      };
      const timer = setTimeout(() => {
        deps.terminate(child);
        finish({ code: null, stdout, stderr, timedOut: true });
      }, GEMINI_STATUS_TIMEOUT_MS);
      try {
        child = spawnAgy(command, ['models']);
      } catch {
        finish({ code: null, stdout, stderr, spawnFailed: true });
        return;
      }
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => {});
      child.stdout.on('data', (chunk: Buffer) => (stdout = (stdout + chunk).slice(-MAX_OUTPUT)));
      child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk).slice(-MAX_OUTPUT)));
      child.on('error', () => finish({ code: null, stdout, stderr, spawnFailed: true }));
      child.on('close', (code) => finish({ code, stdout, stderr }));
      child.stdin.end();
    });
  };

  const status = () => {
    // Concurrent callers share one run; each call after it finishes checks again.
    statusRun ??= checkStatus().finally(() => {
      statusRun = null;
    });
    return statusRun;
  };

  const cancelLogin = () => {
    const current = login;
    login = null;
    if (!current) return;
    clearTimeout(current.timer);
    deps.terminate(current.child);
  };

  const startLogin = async (): Promise<GeminiLoginStart> => {
    cancelLogin();
    const command = await deps.locate();
    if (!command) throw new Error('Antigravity CLI is not installed');
    const child = spawnAgy(command, ['acp', '--login']);
    const decoder = new StringDecoder('utf8');
    let output = '';
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => {});
    const exited = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(null));
    });
    const timer = setTimeout(cancelLogin, GEMINI_LOGIN_TIMEOUT_MS);
    const current = { child, url: null as string | null, exited, timer };
    login = current;
    exited.then(() => {
      clearTimeout(timer);
      if (login === current && !current.url) login = null;
    });
    const url = await new Promise<string | null>((resolve) => {
      const wait = setTimeout(() => resolve(null), 20_000);
      const read = (chunk: Buffer) => {
        output = (output + decoder.write(chunk)).slice(-MAX_OUTPUT);
        const found = parseLoginUrl(output);
        if (found) {
          clearTimeout(wait);
          resolve(found);
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      void exited.then(() => {
        clearTimeout(wait);
        resolve(parseLoginUrl(output));
      });
    });
    if (!url || login !== current) {
      if (login === current) cancelLogin();
      throw new Error('Antigravity did not offer a Google sign-in link');
    }
    current.url = url;
    // Stdin stays open: agy cancels the sign-in when it closes.
    await deps.openExternal(url).catch(() => {});
    return { url };
  };

  const submitLogin = async (value: unknown): Promise<GeminiAccountStatus> => {
    const code = validLoginCode(value);
    if (!code) throw new Error('Invalid authorization code');
    const current = login;
    if (!current?.url) throw new Error('No Google sign-in is in progress');
    current.child.stdin.end(code + '\n');
    const exit = await Promise.race([
      current.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 60_000)),
    ]);
    if (login === current) {
      clearTimeout(current.timer);
      login = null;
    }
    if (exit === 'timeout') deps.terminate(current.child);
    if (exit !== 0) throw new Error('Google sign-in did not finish');
    return status();
  };

  return { status, startLogin, submitLogin, cancelLogin, dispose: cancelLogin };
}
