/**
 * Colour looks for clips and stills, applied with the 2D canvas `filter` when
 * a frame is handed to the compositor, so the preview and the export get the
 * same pixels. (eVoice Studio addition to the vendored OpenCut renderer.)
 */
import type { ParamValues } from './vendor/params';

export const FILTER_PRESETS = ['none', 'vivid', 'warm', 'cool', 'mono', 'vintage'] as const;
export type FilterPreset = (typeof FILTER_PRESETS)[number];

const PRESET_CSS: Record<FilterPreset, string> = {
  none: '',
  vivid: 'saturate(1.45) contrast(1.1)',
  warm: 'sepia(0.25) saturate(1.2) hue-rotate(-8deg)',
  cool: 'saturate(0.9) hue-rotate(12deg) brightness(1.04)',
  mono: 'grayscale(1) contrast(1.08)',
  vintage: 'sepia(0.55) contrast(0.92) brightness(1.05) saturate(0.85)',
};

const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** The canvas filter for an element's colour params, or '' when it has none. */
export function colorFilterFor(params: ParamValues): string {
  const preset = FILTER_PRESETS.includes(params['filter.preset'] as FilterPreset)
    ? (params['filter.preset'] as FilterPreset)
    : 'none';
  const parts = [PRESET_CSS[preset]];
  const brightness = number(params['filter.brightness'], 1);
  const contrast = number(params['filter.contrast'], 1);
  const saturation = number(params['filter.saturation'], 1);
  if (brightness !== 1) parts.push(`brightness(${brightness})`);
  if (contrast !== 1) parts.push(`contrast(${contrast})`);
  if (saturation !== 1) parts.push(`saturate(${saturation})`);
  return parts.filter(Boolean).join(' ');
}

const filtered = new Map<string, OffscreenCanvas>();

/**
 * Draws `source` through `filter` into a canvas kept per texture id. Returns
 * the source itself when there is no filter.
 */
export function applyColorFilter(
  textureId: string,
  source: CanvasImageSource,
  width: number,
  height: number,
  filter: string | undefined,
): CanvasImageSource {
  if (!filter) {
    filtered.delete(textureId);
    return source;
  }
  let canvas = filtered.get(textureId);
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    filtered.set(textureId, canvas);
  }
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, width, height);
  context.filter = filter;
  context.drawImage(source, 0, 0, width, height);
  context.filter = 'none';
  return canvas;
}
