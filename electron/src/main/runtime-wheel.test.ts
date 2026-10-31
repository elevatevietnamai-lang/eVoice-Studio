// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadLockedWheel, findLockedCudaWheel, type LockedWheel } from './runtime-wheel';

const LOCK = `version = 1

[[package]]
name = "torch"
version = "2.8.0"
source = { registry = "https://pypi.org/simple" }
wheels = [
    { url = "https://files.pythonhosted.org/x/torch-2.8.0-cp311-cp311-win_amd64.whl", hash = "sha256:${'a'.repeat(64)}", size = 241366752 },
]

[[package]]
name = "torch"
version = "2.8.0+cpu"
source = { registry = "https://download.pytorch.org/whl/cpu" }
wheels = [
    { url = "https://download.pytorch.org/whl/cpu/torch-2.8.0%2Bcpu-cp311-cp311-win_amd64.whl", hash = "sha256:${'c'.repeat(64)}" },
]

[[package]]
name = "torch"
version = "2.8.0+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }
wheels = [
    { url = "https://download.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp311-cp311-manylinux_2_28_x86_64.whl", hash = "sha256:${'b'.repeat(64)}" },
    { url = "https://download.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp311-cp311-win_amd64.whl", hash = "sha256:${'d'.repeat(64)}" },
]
`;

describe('findLockedCudaWheel', () => {
  it('returns the locked CUDA wheel for Windows x64 with a decoded filename', () => {
    expect(findLockedCudaWheel(LOCK, 'torch', 'win32', 'x64')).toEqual({
      name: 'torch',
      version: '2.8.0+cu128',
      filename: 'torch-2.8.0+cu128-cp311-cp311-win_amd64.whl',
      url: 'https://download.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp311-cp311-win_amd64.whl',
      sha256: 'd'.repeat(64),
    });
  });

  it('uses the manylinux x86_64 wheel on Linux and ignores CRLF line endings', () => {
    const wheel = findLockedCudaWheel(LOCK.replace(/\n/g, '\r\n'), 'torch', 'linux', 'x64');
    expect(wheel?.filename).toBe('torch-2.8.0+cu128-cp311-cp311-manylinux_2_28_x86_64.whl');
    expect(wheel?.sha256).toBe('b'.repeat(64));
  });

  it('returns null where there is no CUDA wheel to prefetch', () => {
    expect(findLockedCudaWheel(LOCK, 'torch', 'darwin', 'arm64')).toBeNull();
    expect(findLockedCudaWheel(LOCK, 'torch', 'linux', 'arm64')).toBeNull();
    expect(findLockedCudaWheel(LOCK, 'torchaudio', 'win32', 'x64')).toBeNull();
    expect(findLockedCudaWheel('version = 1\n', 'torch', 'win32', 'x64')).toBeNull();
  });
});

describe('downloadLockedWheel', () => {
  const body = Buffer.from(Array.from({ length: 64 * 1024 }, (_, i) => (i * 31 + 7) % 251));
  const sha = createHash('sha256').update(body).digest('hex');
  let server: Server;
  let dir: string;
  let url: string;
  let requests: { range?: string }[];
  let behaviour: (req: IncomingMessage, res: ServerResponse, n: number) => void;

  const wheel = (over: Partial<LockedWheel> = {}): LockedWheel => ({
    name: 'torch',
    version: '2.8.0+cu128',
    filename: 'torch-2.8.0+cu128-cp311-cp311-win_amd64.whl',
    url,
    sha256: sha,
    ...over,
  });
  const options = () => ({ env: {}, signal: new AbortController().signal, backoffMs: 1 });

  beforeEach(async () => {
    requests = [];
    dir = await mkdtemp(join(tmpdir(), 'vs-wheel-test-'));
    server = createServer((req, res) => {
      requests.push({ range: req.headers.range });
      behaviour(req, res, requests.length);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/torch.whl`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  function serveRanges(req: IncomingMessage, res: ServerResponse): void {
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    if (!match) {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
      return;
    }
    const start = Number(match[1]);
    if (start >= body.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Length': body.length - start,
      'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`,
    });
    res.end(body.subarray(start));
  }

  it('downloads the whole wheel and verifies its checksum', async () => {
    behaviour = serveRanges;
    const file = await downloadLockedWheel(wheel(), dir, options());
    expect(file).toBe(join(dir, wheel().filename));
    expect((await readFile(file)).equals(body)).toBe(true);
    expect(existsSync(`${file}.part`)).toBe(false);
  });

  it('resumes with a Range request after the connection drops mid-transfer', async () => {
    const cut = 20_000;
    behaviour = (req, res, n) => {
      if (n === 1) {
        res.writeHead(200, { 'Content-Length': body.length });
        res.write(body.subarray(0, cut));
        setTimeout(() => res.destroy(), 20);
        return;
      }
      serveRanges(req, res);
    };
    const file = await downloadLockedWheel(wheel(), dir, options());
    expect((await readFile(file)).equals(body)).toBe(true);
    expect(requests[0].range).toBeUndefined();
    const start = Number(/^bytes=(\d+)-$/.exec(requests[1].range ?? '')?.[1]);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThanOrEqual(cut);
  });

  it('continues a partial file left by an earlier run of the app', async () => {
    behaviour = serveRanges;
    await writeFile(join(dir, `${wheel().filename}.part`), body.subarray(0, 30_000));
    const file = await downloadLockedWheel(wheel(), dir, options());
    expect((await readFile(file)).equals(body)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].range).toBe('bytes=30000-');
  });

  it('starts over when the server ignores Range and answers 200', async () => {
    behaviour = (_req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    };
    await writeFile(join(dir, `${wheel().filename}.part`), Buffer.from('stale partial data'));
    const file = await downloadLockedWheel(wheel(), dir, options());
    expect((await readFile(file)).equals(body)).toBe(true);
  });

  it('treats 416 on a complete partial file as done and lets the hash decide', async () => {
    behaviour = serveRanges;
    await writeFile(join(dir, `${wheel().filename}.part`), body);
    const file = await downloadLockedWheel(wheel(), dir, options());
    expect((await readFile(file)).equals(body)).toBe(true);
    expect(requests[0].range).toBe(`bytes=${body.length}-`);
  });

  it('deletes a corrupt download, retries once, then fails on a second mismatch', async () => {
    behaviour = serveRanges;
    await expect(
      downloadLockedWheel(wheel({ sha256: 'f'.repeat(64) }), dir, options()),
    ).rejects.toThrow(/does not match its locked hash/);
    expect(existsSync(join(dir, `${wheel().filename}.part`))).toBe(false);
    expect(existsSync(join(dir, wheel().filename))).toBe(false);
    expect(requests.length).toBe(2);
  });

  it('keeps an already verified wheel without touching the network', async () => {
    behaviour = serveRanges;
    await writeFile(join(dir, wheel().filename), body);
    await downloadLockedWheel(wheel(), dir, options());
    expect(requests).toHaveLength(0);
  });

  it('gives up with a retry hint when nothing ever arrives', async () => {
    behaviour = (_req, res) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.destroy();
    };
    await expect(downloadLockedWheel(wheel(), dir, options())).rejects.toThrow(/keeps dropping/);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it('only downloads over HTTPS (loopback http is for tests)', async () => {
    behaviour = serveRanges;
    await expect(
      downloadLockedWheel(wheel({ url: 'http://example.com/torch.whl' }), dir, options()),
    ).rejects.toThrow(/HTTPS/);
  });
});
