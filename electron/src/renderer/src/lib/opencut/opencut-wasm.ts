/**
 * Loads OpenCut's compositor (opencut-wasm, MIT) without a bundler wasm plugin.
 *
 * The package is a wasm-pack `bundler` build whose entry imports the `.wasm`
 * file as an ES module, which Vite does not support. The glue (`_bg.js`) and
 * the binary are fetched separately here and wired together the same way the
 * entry would. The vendored OpenCut sources import this module instead.
 */
// @ts-expect-error The glue module ships without its own type declarations.
import * as glue from 'opencut-wasm/opencut_wasm_bg.js';
import wasmUrl from 'opencut-wasm/opencut_wasm_bg.wasm?url';

export type * from 'opencut-wasm';
type Api = typeof import('opencut-wasm');

const imports = { './opencut_wasm_bg.js': glue };

async function instantiate(): Promise<WebAssembly.Instance> {
  if (import.meta.env.MODE === 'test') {
    // Vitest runs on Node, where the bundled URL is not fetchable: read the file.
    const node = (
      globalThis as unknown as {
        process: {
          getBuiltinModule(id: 'node:module'): {
            createRequire(from: string): { resolve(id: string): string };
          };
          getBuiltinModule(id: 'node:fs'): { readFileSync(path: string): Uint8Array<ArrayBuffer> };
        };
      }
    ).process;
    const path = node
      .getBuiltinModule('node:module')
      .createRequire(import.meta.url)
      .resolve('opencut-wasm/opencut_wasm_bg.wasm');
    const bytes = node.getBuiltinModule('node:fs').readFileSync(path);
    return (await WebAssembly.instantiate(bytes, imports)).instance;
  }
  return (await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports)).instance;
}

const instance = await instantiate();
glue.__wbg_set_wasm(instance.exports);
(instance.exports.__wbindgen_start as () => void)();

const api = glue as Api;
export const {
  TICKS_PER_SECOND,
  applyEffectPasses,
  applyMaskFeather,
  floorToFrame,
  formatTimecode,
  getCompositorCanvas,
  getLastFrameProfile,
  guessTimecodeFormat,
  initCompositor,
  initializeGpu,
  isFrameAligned,
  lastFrameTime,
  mediaTimeAdd,
  mediaTimeClamp,
  mediaTimeFromFrame,
  mediaTimeFromSeconds,
  mediaTimeMax,
  mediaTimeMin,
  mediaTimeSub,
  mediaTimeToFrame,
  mediaTimeToSeconds,
  parseTimecode,
  releaseTexture,
  renderFrame,
  resizeCompositor,
  roundToFrame,
  snappedSeekTime,
  uploadTexture,
} = api;
