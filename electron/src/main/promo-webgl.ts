import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME_OFFLINE_FLAGS } from './promo-network-guard';
import { packageDir } from './promo-scene-runtime';

/**
 * Can the render draw WebGL? 3D scenes (three.js) need it, and HyperFrames
 * renders on SwiftShader, Chrome's CPU implementation, on every OS by default.
 * This launches the downloaded Chrome Headless Shell with the producer's own
 * flags (its `buildChromeArgs`) plus the offline flags, draws one cleared
 * pixel with WebGL and reads it back. A machine where that fails gets 3D
 * scenes turned off with a clear message; everything else keeps working.
 */

export interface WebglVerdict {
  ok: boolean;
  /** UNMASKED_RENDERER_WEBGL or the failure. */
  detail: string;
}

/** A package folder as one of the producer's own dependencies resolves it. */
function producerDependency(name: string): string {
  const producer = realpathSync(packageDir('@hyperframes/producer'));
  const resolver = createRequire(join(producer, 'package.json'));
  const base = (resolver.resolve.paths(name) ?? []).find((path) => existsSync(join(path, name)));
  if (!base) throw new Error(`not_found:${name}`);
  return realpathSync(join(base, name));
}

interface Engine {
  buildChromeArgs(options: { width: number; height: number; captureMode?: string }, config?: unknown): string[];
}
interface Puppeteer {
  launch(options: unknown): Promise<{
    newPage(): Promise<{ evaluate<T>(fn: () => T): Promise<T> }>;
    close(): Promise<void>;
  }>;
}

/** Runs in the page: clear to a known colour, read one pixel back. */
function drawOnePixel(): { ok: boolean; detail: string } {
  const doc = (globalThis as unknown as { document: { createElement(tag: string): unknown } })
    .document;
  const canvas = doc.createElement('canvas') as {
    width: number;
    height: number;
    getContext(kind: string, options?: unknown): unknown;
  };
  canvas.width = 4;
  canvas.height = 4;
  type GL = {
    clearColor(r: number, g: number, b: number, a: number): void;
    clear(mask: number): void;
    readPixels(x: number, y: number, w: number, h: number, f: number, t: number, out: Uint8Array): void;
    getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
    getParameter(id: number): unknown;
    COLOR_BUFFER_BIT: number;
    RGBA: number;
    UNSIGNED_BYTE: number;
    RENDERER: number;
  };
  const gl = (canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ??
    canvas.getContext('webgl', { preserveDrawingBuffer: true })) as GL | null;
  if (!gl) return { ok: false, detail: 'no_context' };
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const drawn = pixel[0] < 10 && pixel[1] > 245 && pixel[2] < 10;
  return { ok: drawn, detail: drawn ? renderer : `wrong_pixel:${renderer}` };
}

export async function probeWebgl(chromePath: string, timeoutMs = 30_000): Promise<WebglVerdict> {
  let browser: Awaited<ReturnType<Puppeteer['launch']>> | null = null;
  const timer = new Promise<WebglVerdict>((resolve) =>
    setTimeout(() => resolve({ ok: false, detail: 'timeout' }), timeoutMs).unref(),
  );
  const run = async (): Promise<WebglVerdict> => {
    const engineDir = producerDependency('@hyperframes/engine');
    const engine = (await import(
      pathToFileURL(join(engineDir, 'dist', 'index.js')).href
    )) as Engine;
    const puppeteer = createRequire(join(engineDir, 'package.json'))('puppeteer-core') as Puppeteer;
    const args = engine
      .buildChromeArgs({ width: 256, height: 256, captureMode: 'screenshot' })
      .filter((arg) => !/^--(proxy-server|host-resolver-rules|proxy-bypass-list)=/.test(arg));
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      pipe: true,
      args: [...args, ...CHROME_OFFLINE_FLAGS],
    });
    const page = await browser.newPage();
    return await page.evaluate(drawOnePixel);
  };
  try {
    return await Promise.race([run(), timer]);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    await (browser as { close(): Promise<void> } | null)?.close().catch(() => {});
  }
}
