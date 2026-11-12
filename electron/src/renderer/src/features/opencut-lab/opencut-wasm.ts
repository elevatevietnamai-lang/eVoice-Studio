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

const response = await fetch(wasmUrl);
const { instance } = await WebAssembly.instantiateStreaming(response, {
  './opencut_wasm_bg.js': glue,
});
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
