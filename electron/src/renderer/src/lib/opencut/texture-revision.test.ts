import { beforeAll, describe, expect, it, vi } from 'vitest';

const wasm = vi.hoisted(() => ({ uploadTexture: vi.fn(), releaseTexture: vi.fn() }));
vi.mock('./opencut-wasm', () => ({
  ...wasm,
  getCompositorCanvas: vi.fn(),
  getLastFrameProfile: vi.fn(() => []),
  initCompositor: vi.fn(),
  renderFrame: vi.fn(),
  resizeCompositor: vi.fn(),
}));

// A decoded video frame: the decoder recycles a small pool of these canvases.
class PooledCanvas {}

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', PooledCanvas);
});

describe('video textures from a recycled canvas pool', () => {
  it('uploads again when the same canvas holds a new frame', async () => {
    const { wasmCompositor } = await import('./vendor/services/renderer/compositor/wasm-compositor');
    const canvas = new PooledCanvas() as unknown as CanvasImageSource;
    const frame = (revision: number) => ({
      kind: 'external' as const,
      id: 'clip:source',
      source: canvas,
      width: 1080,
      height: 1920,
      revision,
    });
    wasmCompositor.syncTextures([frame(0.5)]);
    wasmCompositor.syncTextures([frame(0.5)]);
    expect(wasm.uploadTexture).toHaveBeenCalledTimes(1);
    // A seek reuses the pooled canvas for the frame at 2.5 s: it must reach the GPU.
    wasmCompositor.syncTextures([frame(2.5)]);
    expect(wasm.uploadTexture).toHaveBeenCalledTimes(2);
  });
});
