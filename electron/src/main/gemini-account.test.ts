import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiAccount,
  geminiStatusFrom,
  parseGeminiModels,
  parseLoginUrl,
  validLoginCode,
} from './gemini-account';

// Verbatim shape of `agy models` (agy 1.5.9) for a signed-in Google AI Pro account.
const MODELS = `gemini-4-argon-medium\tGemini 4 Argon (Medium)
gemini-4-argon-high\tGemini 4 Argon (High)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
claude-opus-5-5-high\tClaude Opus 5.5 (High)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`;

// Verbatim shape of `agy acp --login`'s prompt (client and state values shortened).
const LOGIN_PROMPT = `Open this link in a browser to log in with Google:

  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x.apps.googleusercontent.com&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&state=abc

Then paste the authorization code, or the full URL of the page you land on, and press Enter:
`;

describe('Gemini account status', () => {
  it('offers only Gemini models from agy models', () => {
    expect(parseGeminiModels(MODELS)).toEqual([
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    ]);
  });

  it('is signed in only when Gemini models are listed', () => {
    expect(geminiStatusFrom({ code: 0, stdout: MODELS, stderr: '' }).state).toBe('signedIn');
    expect(geminiStatusFrom({ code: 0, stdout: 'claude-x\tClaude', stderr: '' }).state).toBe(
      'unknown',
    );
  });

  it('reports signed out from an empty list or the CLI saying so', () => {
    expect(
      geminiStatusFrom({ code: 0, stdout: '', stderr: 'Fetching available models...' }).state,
    ).toBe('signedOut');
    expect(
      geminiStatusFrom({
        code: 1,
        stdout: '',
        stderr: 'error getting token source: You are not logged into Antigravity.',
      }).state,
    ).toBe('signedOut');
  });

  it('never calls a timeout, network failure or missing process signed out', () => {
    expect(geminiStatusFrom({ code: null, stdout: '', stderr: '', timedOut: true }).state).toBe(
      'unknown',
    );
    expect(geminiStatusFrom({ code: null, stdout: '', stderr: '', spawnFailed: true }).state).toBe(
      'unknown',
    );
    expect(
      geminiStatusFrom({
        code: 1,
        stdout: '',
        stderr: 'dial tcp: lookup googleapis.com: no such host',
      }).state,
    ).toBe('unknown');
  });
});

describe('Gemini sign-in', () => {
  it('accepts only a Google sign-in link', () => {
    expect(parseLoginUrl(LOGIN_PROMPT)).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/,
    );
    expect(parseLoginUrl('Open https://accounts.google.com.evil.example/x')).toBeNull();
    expect(parseLoginUrl('Open http://accounts.google.com/x')).toBeNull();
  });

  it('accepts one line of code or the landing URL, and nothing that could add input', () => {
    expect(validLoginCode(' 4/0AbCd-ef_12 ')).toBe('4/0AbCd-ef_12');
    expect(
      validLoginCode('https://antigravity.google/oauth-callback?code=4/0A&state=s'),
    ).toBeTruthy();
    expect(validLoginCode('a\nb')).toBeNull();
    expect(validLoginCode('a b')).toBeNull();
    expect(validLoginCode('')).toBeNull();
    expect(validLoginCode('x'.repeat(5000))).toBeNull();
    expect(validLoginCode(42)).toBeNull();
  });

  function fakeAgy() {
    const children: Array<{ args: string[]; child: FakeChild }> = [];
    const spawnProcess = vi.fn((_exe: string, args: string[]) => {
      const child = new FakeChild();
      children.push({ args, child });
      return child;
    });
    return { children, spawnProcess };
  }

  class FakeChild extends EventEmitter {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    written = '';
    constructor() {
      super();
      this.stdin.on('data', (chunk) => (this.written += chunk));
    }
    exit(code: number) {
      this.emit('close', code);
    }
  }

  function account(fake: ReturnType<typeof fakeAgy>, openExternal = vi.fn(async () => {})) {
    const terminate = vi.fn((child: FakeChild) => child.exit(1));
    return {
      terminate,
      openExternal,
      gemini: createGeminiAccount({
        locate: async () => ({ executable: 'agy', prefix: [] }),
        env: () => ({}),
        terminate: terminate as never,
        openExternal,
        spawnProcess: fake.spawnProcess as never,
      }),
    };
  }

  it('opens the Google link, keeps stdin open, sends the code and re-checks', async () => {
    const fake = fakeAgy();
    const { gemini, openExternal } = account(fake);
    const started = gemini.startLogin();
    await vi.waitFor(() => expect(fake.children).toHaveLength(1));
    const login = fake.children[0];
    expect(login.args).toEqual(['acp', '--login']);
    login.child.stdout.write(LOGIN_PROMPT);
    const { url } = await started;
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(openExternal).toHaveBeenCalledWith(url);
    expect(login.child.stdin.writableEnded).toBe(false);

    const submitted = gemini.submitLogin('4/0AbCd');
    await vi.waitFor(() => expect(login.child.written).toBe('4/0AbCd\n'));
    login.child.exit(0);
    await vi.waitFor(() => expect(fake.children).toHaveLength(2));
    const check = fake.children[1];
    expect(check.args).toEqual(['models']);
    check.child.stdout.write(MODELS);
    check.child.exit(0);
    expect((await submitted).state).toBe('signedIn');
  });

  it('cancels a pending sign-in and refuses a code with none in progress', async () => {
    const fake = fakeAgy();
    const { gemini, terminate } = account(fake);
    const started = gemini.startLogin();
    await vi.waitFor(() => expect(fake.children).toHaveLength(1));
    fake.children[0].child.stdout.write(LOGIN_PROMPT);
    await started;
    gemini.cancelLogin();
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(gemini.submitLogin('4/0AbCd')).rejects.toThrow(/No Google sign-in/);
    await expect(gemini.submitLogin('bad\ncode')).rejects.toThrow(/Invalid/);
  });

  it('fails a sign-in that offers no Google link without opening anything', async () => {
    const fake = fakeAgy();
    const { gemini, openExternal } = account(fake);
    const started = gemini.startLogin();
    await vi.waitFor(() => expect(fake.children).toHaveLength(1));
    fake.children[0].child.stdout.write('Open https://evil.example/login\n');
    fake.children[0].child.exit(1);
    await expect(started).rejects.toThrow(/did not offer/);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('reports a missing CLI as not installed without spawning', async () => {
    const fake = fakeAgy();
    const gemini = createGeminiAccount({
      locate: async () => null,
      env: () => ({}),
      terminate: vi.fn(),
      openExternal: vi.fn(),
      spawnProcess: fake.spawnProcess as never,
    });
    expect(await gemini.status()).toEqual({ installed: false, state: 'unknown', models: [] });
    expect(fake.spawnProcess).not.toHaveBeenCalled();
  });
});
