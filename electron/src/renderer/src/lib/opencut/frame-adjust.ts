/**
 * Per-frame adjustments the editor layers on a clip while it renders, on top
 * of its own keyframes: how transitions fade, move, zoom and wipe clips.
 * (eVoice Studio addition to the vendored OpenCut renderer.)
 */
export interface FrameAdjust {
  /** Multiplies the clip's opacity. */
  opacity?: number;
  /** Moves the clip, in canvas pixels. */
  offsetX?: number;
  offsetY?: number;
  /** Multiplies the clip's scale. */
  scale?: number;
  /** Shows only the part of the canvas between these shares of its width (0..1). */
  clip?: { from: number; to: number };
}

/** The adjustment `seconds` into the clip, or null when there is none. */
export type FrameAdjustFn = (seconds: number) => FrameAdjust | null;

/** Width of the soft edge of a wipe, as a share of the canvas width. */
export const WIPE_EDGE = 0.02;

/** Draws the wipe window as an opaque band with soft edges into a canvas-sized mask. */
export function drawClipMask(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  clip: { from: number; to: number },
): void {
  const edge = WIPE_EDGE * width;
  const from = clip.from * width;
  const to = clip.to * width;
  const gradient = ctx.createLinearGradient(from - edge, 0, to + edge, 0);
  const span = Math.max(1, to - from + 2 * edge);
  const stop = (x: number) => Math.min(1, Math.max(0, (x - (from - edge)) / span));
  gradient.addColorStop(0, clip.from <= 0 ? 'white' : 'rgba(255,255,255,0)');
  gradient.addColorStop(stop(from + edge / 2), 'white');
  gradient.addColorStop(stop(to - edge / 2), 'white');
  gradient.addColorStop(1, clip.to >= 1 ? 'white' : 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(Math.max(0, from - edge), 0, Math.min(width, to + edge) - Math.max(0, from - edge), height);
}
