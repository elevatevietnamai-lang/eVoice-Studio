import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIMIT = 1_000_000;
let dir: string;
let server: Server;
let baseUrl: string;
let streamClosed: Promise<void>;
let markClosed: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vs-repair-mcp-'));
  const source = readFileSync(join(__dirname, 'repair-mcp-server.ts'), 'utf8');
  const { code } = await transformWithOxc(source, 'repair-mcp-server.ts');
  writeFileSync(join(dir, 'server.mjs'), code);
  server = createServer((req, res) => {
    if (req.url === '/endless') {
      // Never finishes: three-byte characters so the byte cap lands mid-character.
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      const chunk = Buffer.from('€'.repeat(40_000));
      const timer = setInterval(() => res.write(chunk), 1);
      res.on('close', () => {
        clearInterval(timer);
        markClosed();
      });
      return;
    }
    if (req.url === '/silent') {
      // Sends headers, then nothing: a hung backend.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.flushHeaders();
      return;
    }
    if (req.url === '/slow-headers') {
      // A blocking route (`/generate`): silent until its job ends.
      setTimeout(() => res.writeHead(200).end('{"ok": true}'), 2_500);
      return;
    }
    if (req.url === '/dub-stream' || req.url === '/failed-stream') {
      // Dub streams name each event in its JSON `type`, with no `event:` line.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const data = (value: object) => `data: ${JSON.stringify(value)}\n\n`;
      for (let current = 1; current <= 3; current += 1)
        res.write(data({ type: 'progress', current, total: 3, text: `line ${current}` }));
      res.write(data({ type: 'error', segment: 2, error: 'one segment failed' }));
      res.end(req.url === '/dub-stream' ? data({ type: 'done', segments: 3 }) : '');
      return;
    }
    if (req.url === '/slow-stream' || req.url === '/progress-flood') {
      // A generation job: progress events, then its result. The slow stream outlasts the idle
      // timeout in total but never goes quiet for that long; the flood outgrows the byte cap.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const progress = (value: number) =>
        `event: progress\ndata: {"type": "progress", "progress": ${value}, "message": "Generating"}\n\n`;
      const finish = () =>
        res.end('event: track\ndata: {"id": "abc"}\n\nevent: done\ndata: {"track": {"id": "abc"}}\n\n');
      if (req.url === '/progress-flood') {
        res.write(progress(0).repeat(16_000));
        finish();
        return;
      }
      let step = 0;
      const timer = setInterval(() => {
        step += 1;
        if (step <= 8) res.write(progress(step / 10));
        else {
          clearInterval(timer);
          finish();
        }
      }, 250);
      res.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(200).end('hello €');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  writeFileSync(join(dir, 'context.json'), JSON.stringify({ baseUrl, headers: {} }));
  streamClosed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function call(
  lines: string[],
  env: Record<string, string> = {},
): Promise<Array<Record<string, any>>> {
  const child = spawn(process.execPath, [join(dir, 'server.mjs')], {
    env: { ...process.env, VOICESTUDIO_REPAIR_CONTEXT_FILE: join(dir, 'context.json'), ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const expected = lines.length;
  const messages: Array<Record<string, any>> = [];
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      out += data;
      const parts = out.split('\n');
      out = parts.pop() ?? '';
      for (const part of parts) if (part) messages.push(JSON.parse(part));
      // Notifications carry no id; resolve once every request has its reply.
      if (messages.filter((message) => 'id' in message).length >= expected) {
        child.kill();
        resolve(messages);
      }
    });
    child.on('error', reject);
    child.stdin.write(lines.map((line) => line + '\n').join(''));
  });
}

const apiCall = (path: string, meta?: Record<string, unknown>) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'api_request', arguments: { path }, ...(meta ? { _meta: meta } : {}) },
  });

const quickIdle = { VOICESTUDIO_REPAIR_IDLE_TIMEOUT_MS: '1000' };

describe('repair MCP api_request', () => {
  it('returns small responses untouched', async () => {
    const [reply] = await call([apiCall('/small')]);
    expect(reply.result.content[0].text).toBe('HTTP 200\nhello €');
  });

  it('stops reading an endless response at the byte cap and cancels the stream', async () => {
    const [reply] = await call([apiCall('/endless')]);
    const text: string = reply.result.content[0].text;
    const body = text.slice('HTTP 200\n'.length);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(LIMIT);
    expect(Buffer.byteLength(body)).toBeGreaterThan(LIMIT - 3);
    expect(body).not.toContain('�');
    await streamClosed;
  }, 20_000);

  it('refuses oversized request lines and keeps serving afterwards', async () => {
    const huge = 'x'.repeat(9_000_000);
    const replies = await call([huge, apiCall('/small')]);
    expect(replies[0].error.code).toBe(-32600);
    expect(replies[1].result.content[0].text).toBe('HTTP 200\nhello €');
  }, 20_000);

  it('caps request lines in UTF-8 bytes, not UTF-16 units', async () => {
    // 3M three-byte characters: 9 MB of input, but only 3M string units.
    const wide = '€'.repeat(3_000_000);
    expect(wide.length).toBeLessThan(8_000_000);
    const replies = await call([wide, apiCall('/small')]);
    expect(replies[0].error.code).toBe(-32600);
    expect(replies[1].result.content[0].text).toBe('HTTP 200\nhello €');
  }, 20_000);

  it('waits out a stream that runs longer than the idle timeout, returning its result without progress lines', async () => {
    const [reply] = await call([apiCall('/slow-stream')], quickIdle);
    const text: string = reply.result.content[0].text;
    expect(reply.result.isError).toBe(false);
    expect(text).toContain('event: done');
    expect(text).not.toContain('event: progress');
  }, 20_000);

  it('keeps the result of a stream whose progress alone passes the byte cap', async () => {
    const [reply] = await call([apiCall('/progress-flood')]);
    expect(reply.result.content[0].text).toContain('event: done');
  }, 20_000);

  it('stops a request when the backend goes quiet, and says why', async () => {
    const [reply] = await call([apiCall('/silent')], quickIdle);
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toMatch(/sent nothing for 1 s/);
  }, 20_000);

  it('waits for a blocking route past the idle timeout: only a started response can go quiet', async () => {
    const [reply] = await call([apiCall('/slow-headers')], quickIdle);
    expect(reply.result.isError).toBe(false);
    expect(reply.result.content[0].text).toBe('HTTP 200\n{"ok": true}');
  }, 20_000);

  it('reads progress named in the JSON type, and only a final error fails the call', async () => {
    const messages = await call([apiCall('/dub-stream', { progressToken: 7 })]);
    const notes = messages.filter((message) => message.method === 'notifications/progress');
    expect(notes.map((note) => note.params.progress)).toEqual([1 / 3, 2 / 3, 1]);
    const reply = messages.at(-1)!;
    expect(reply.result.isError).toBe(false);
    expect(reply.result.content[0].text).not.toContain('"progress"');
    expect(reply.result.content[0].text).toContain('one segment failed');
    const [failed] = await call([apiCall('/failed-stream')]);
    expect(failed.result.isError).toBe(true);
  }, 20_000);

  it('forwards stream progress as MCP progress notifications when asked', async () => {
    const messages = await call([apiCall('/slow-stream', { progressToken: 'p1' })], quickIdle);
    const notes = messages.filter((message) => message.method === 'notifications/progress');
    expect(notes.length).toBe(8);
    expect(notes.every((note) => note.params.progressToken === 'p1')).toBe(true);
    const values = notes.map((note) => note.params.progress);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(messages.at(-1)?.result.content[0].text).toContain('event: done');
  }, 20_000);
});
