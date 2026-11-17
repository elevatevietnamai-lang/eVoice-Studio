import { readFileSync } from 'node:fs';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface RepairContext {
  baseUrl: string;
  headers: Record<string, string>;
}

const MAX_RESPONSE = 1_000_000;
// A single JSON-RPC line (tool arguments included) larger than this is refused.
const MAX_REQUEST_LINE = 8_000_000;
const configuredContextPath = process.env.VOICESTUDIO_REPAIR_CONTEXT_FILE;
if (!configuredContextPath) throw new Error('VOICESTUDIO_REPAIR_CONTEXT_FILE is required');
const contextPath: string = configuredContextPath;

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: JsonRpcRequest['id'], value: unknown): void {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id: JsonRpcRequest['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * A request is stopped only when the backend goes quiet: generation endpoints (music, dubbing,
 * speech) stream progress for many minutes, and a fixed total timeout cut them off mid-run and
 * cancelled the job. The total cap only guards against a stream that never ends.
 */
const IDLE_TIMEOUT_MS = Number(process.env.VOICESTUDIO_REPAIR_IDLE_TIMEOUT_MS) || 120_000;
const TOTAL_TIMEOUT_MS = 60 * 60_000;

/** One parsed `progress` event of a server-sent event stream. */
interface StreamProgress {
  progress?: number;
  message?: string;
}

/** Reads at most `limit` bytes, cancels the rest of the stream, and never emits a split UTF-8 character. */
async function readBounded(
  response: Response,
  limit: number,
  onChunk: () => void = () => {},
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      onChunk();
      const room = limit - received;
      if (value.byteLength >= room) {
        // Bytes of a character cut by the limit stay buffered in the decoder and are dropped.
        return text + decoder.decode(value.subarray(0, room), { stream: true });
      }
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Cuts `text` to at most `limit` UTF-8 bytes without splitting a character. */
function clipBytes(text: string, limit: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= limit) return text;
  return new TextDecoder('utf-8').decode(bytes.subarray(0, limit), { stream: true });
}

/**
 * Reads a server-sent event stream for an agent. Progress events are reported through
 * `onProgress` and left out of the text, so a long job's result (`track`, `done`, `error`) is
 * never pushed past the byte cap by hundreds of progress lines. The last progress event is kept
 * when the stream ends without any other event.
 */
async function readEventStream(
  response: Response,
  limit: number,
  onChunk: () => void,
  onProgress: (progress: StreamProgress) => void,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  let kept = '';
  let lastProgress = '';
  const take = (event: string): boolean => {
    if (!event.trim()) return false;
    if (/^event:\s*progress\s*$/m.test(event)) {
      lastProgress = event;
      const data = /^data:\s?(.*)$/m.exec(event)?.[1];
      if (data) {
        try {
          onProgress(JSON.parse(data) as StreamProgress);
        } catch {
          // A progress line that is not JSON is still progress; there is nothing to report.
        }
      }
      return false;
    }
    kept += `${event}\n\n`;
    return Buffer.byteLength(kept, 'utf8') >= limit;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) pending += decoder.decode();
      else {
        onChunk();
        pending += decoder.decode(value, { stream: true });
      }
      const events = pending.split(/\r?\n\r?\n/);
      pending = done ? '' : (events.pop() ?? '');
      for (const event of events) if (take(event)) return clipBytes(kept, limit);
      // One endless event without a blank line is held to the same cap.
      if (Buffer.byteLength(pending, 'utf8') >= limit) return clipBytes(kept + pending, limit);
      if (done) return clipBytes(kept || lastProgress, limit);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function callApi(
  args: Record<string, unknown>,
  onProgress: (progress: StreamProgress) => void = () => {},
) {
  const path = typeof args.path === 'string' ? args.path : '';
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('path must start with /');
  const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    throw new Error('unsupported method');
  const context = JSON.parse(readFileSync(contextPath, 'utf8')) as RepairContext;
  const headers: Record<string, string> = { ...context.headers };
  const hasBody = args.body !== undefined && !['GET', 'HEAD'].includes(method);
  if (hasBody) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const stop = (message: string) => () => controller.abort(new Error(message));
  const quiet = stop(
    `VoiceStudio sent nothing for ${Math.round(IDLE_TIMEOUT_MS / 1000)} s, so the request was stopped`,
  );
  const total = setTimeout(
    stop(`The request ran past ${TOTAL_TIMEOUT_MS / 60_000} minutes and was stopped`),
    TOTAL_TIMEOUT_MS,
  );
  let idle = setTimeout(quiet, IDLE_TIMEOUT_MS);
  const alive = () => {
    clearTimeout(idle);
    idle = setTimeout(quiet, IDLE_TIMEOUT_MS);
  };
  try {
    const response = await fetch(`${context.baseUrl}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(args.body) : undefined,
      signal: controller.signal,
    });
    alive();
    const text = /^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '')
      ? await readEventStream(response, MAX_RESPONSE, alive, onProgress)
      : await readBounded(response, MAX_RESPONSE, alive);
    return {
      content: [
        {
          type: 'text',
          text: `HTTP ${response.status}${text ? `\n${text}` : ''}`,
        },
      ],
      isError: !response.ok,
    };
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}

/** Forwards stream progress as MCP progress notifications when the client asked for them. */
function progressNotifier(request: JsonRpcRequest): (progress: StreamProgress) => void {
  const meta = request.params?._meta as { progressToken?: unknown } | undefined;
  const token = meta?.progressToken;
  if (typeof token !== 'string' && typeof token !== 'number') return () => {};
  let last = -1;
  let count = 0;
  return ({ progress, message }) => {
    // MCP requires the value to grow with every notification.
    const value = typeof progress === 'number' && progress > last ? progress : last + 1e-6;
    last = value;
    count += 1;
    send({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: {
        progressToken: token,
        progress: value,
        ...(typeof progress === 'number' && progress <= 1 ? { total: 1 } : {}),
        ...(typeof message === 'string' && message ? { message } : { message: `step ${count}` }),
      },
    });
  };
}

async function handle(request: JsonRpcRequest): Promise<void> {
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize') {
    result(request.id, {
      protocolVersion:
        typeof request.params?.protocolVersion === 'string'
          ? request.params.protocolVersion
          : '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'voicestudio-repair', version: '1.0.0' },
    });
    return;
  }
  if (request.method === 'ping') {
    result(request.id, {});
    return;
  }
  if (request.method === 'tools/list') {
    result(request.id, {
      tools: [
        {
          name: 'api_request',
          title: 'VoiceStudio app API',
          description:
            'Read or update the running VoiceStudio app through its session-scoped repair bridge. Read /openapi.json before calling a route you have not seen in it; do not guess paths. Use /__voicestudio/status plus the Electron controls listed in the repair context for backend recovery. Generation routes that stream progress (music, dubbing, speech) can run for many minutes: one call waits for the whole job and returns its final events, so do not call it again while it runs.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute bridge path beginning with /' },
              method: {
                type: 'string',
                enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
                default: 'GET',
              },
              body: { description: 'Optional JSON request body' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }
  if (request.method === 'tools/call') {
    if (request.params?.name !== 'api_request') {
      error(request.id, -32602, 'Unknown VoiceStudio repair tool');
      return;
    }
    try {
      result(
        request.id,
        await callApi(
          (request.params.arguments as Record<string, unknown> | undefined) ?? {},
          progressNotifier(request),
        ),
      );
    } catch (reason) {
      result(request.id, {
        content: [
          {
            type: 'text',
            text: reason instanceof Error ? reason.message : 'VoiceStudio API request failed',
          },
        ],
        isError: true,
      });
    }
    return;
  }
  if (request.id !== undefined) error(request.id, -32601, 'Method not found');
}

let pending = '';
// UTF-8 bytes in `pending`: the cap is in bytes, and a string's .length counts
// UTF-16 units, so CJK input could otherwise buffer ~3x the cap.
let pendingBytes = 0;
let discarding = false;
function refuseOversized(): void {
  pending = '';
  pendingBytes = 0;
  discarding = true;
  error(null, -32600, 'Request too large');
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  if (!chunk.includes('\n')) {
    // Mid-line: keep buffering, but never past the request cap.
    if (discarding) return;
    pending += chunk;
    pendingBytes += Buffer.byteLength(chunk, 'utf8');
    if (pendingBytes > MAX_REQUEST_LINE) refuseOversized();
    return;
  }
  const lines = (discarding ? chunk : pending + chunk).split(/\r?\n/);
  pending = lines.pop() ?? '';
  pendingBytes = Buffer.byteLength(pending, 'utf8');
  // The first line of this chunk finishes an oversized request that was already refused.
  if (discarding) lines.shift();
  discarding = false;
  if (pendingBytes > MAX_REQUEST_LINE) refuseOversized();
  for (const line of lines) {
    if (!line.trim()) continue;
    // A line completed within one chunk never passed the buffering check above.
    if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_LINE) {
      error(null, -32600, 'Request too large');
      continue;
    }
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      void handle(request).catch(() => error(request.id, -32603, 'Internal error'));
    } catch {
      error(null, -32700, 'Parse error');
    }
  }
});
