/**
 * Masks on clips and stills: a rectangle, an ellipse or a horizontal band,
 * placed relative to the clip, with a soft edge and an invert switch. Position,
 * size, rotation and softness can be keyframed (paths `mask.<param>`).
 */
import type { TimelineElement } from '@/lib/opencut/vendor/timeline/types';
import type { NumberParamDefinition } from '@/lib/opencut/vendor/params';
import type { Mask } from '@/lib/opencut/vendor/masks/types';
import { MASK_PATH_PREFIX } from '@/lib/opencut/mask-keyframes';
import { newId } from './project';

export const MASK_SHAPES = ['none', 'rectangle', 'ellipse', 'band'] as const;
export type MaskShape = (typeof MASK_SHAPES)[number];
const TYPE_OF: Record<Exclude<MaskShape, 'none'>, Mask['type']> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  band: 'cinematic-bars',
};

export const MASK_KEYS = ['centerX', 'centerY', 'width', 'height', 'rotation', 'feather'] as const;
export type MaskKey = (typeof MASK_KEYS)[number];

/** Ranges for the mask params the editor shows (shares of the clip; degrees; pixels). */
export const MASK_PARAMS: Record<MaskKey, NumberParamDefinition> = {
  centerX: { key: 'centerX', label: 'X', type: 'number', default: 0, min: -1, max: 1, step: 0.001 },
  centerY: { key: 'centerY', label: 'Y', type: 'number', default: 0, min: -1, max: 1, step: 0.001 },
  width: { key: 'width', label: 'Width', type: 'number', default: 0.6, min: 0.02, max: 2, step: 0.001 },
  height: { key: 'height', label: 'Height', type: 'number', default: 0.6, min: 0.02, max: 2, step: 0.001 },
  rotation: { key: 'rotation', label: 'Rotation', type: 'number', default: 0, min: -180, max: 180, step: 1 },
  feather: { key: 'feather', label: 'Feather', type: 'number', default: 0, min: 0, max: 200, step: 1 },
};

export const isMaskPath = (path: string): boolean => path.startsWith(MASK_PATH_PREFIX);
export const maskKeyOf = (path: string): MaskKey | null => {
  const key = path.slice(MASK_PATH_PREFIX.length) as MaskKey;
  return isMaskPath(path) && MASK_KEYS.includes(key) ? key : null;
};

export function maskShapeOf(element: TimelineElement): MaskShape {
  const mask = 'masks' in element ? element.masks?.[0] : undefined;
  if (!mask) return 'none';
  const shape = (Object.keys(TYPE_OF) as Exclude<MaskShape, 'none'>[]).find((item) => TYPE_OF[item] === mask.type);
  return shape ?? 'none';
}

/** A new mask of `shape`, centred on the clip. The band spans the whole width. */
export function buildMask(shape: Exclude<MaskShape, 'none'>): Mask {
  const base = { feather: 0, inverted: false, strokeColor: '#ffffff', strokeWidth: 0, strokeAlign: 'center' as const };
  const box = { centerX: 0, centerY: 0, rotation: 0, scale: 1 };
  if (shape === 'band')
    return { id: newId(), type: 'cinematic-bars', params: { ...base, ...box, width: 2, height: 0.4 } };
  return { id: newId(), type: TYPE_OF[shape], params: { ...base, ...box, width: 0.6, height: 0.6 } } as Mask;
}

/** The mask param's value as saved (without keyframes). */
export function maskValue(element: TimelineElement, key: MaskKey): number {
  const mask = 'masks' in element ? element.masks?.[0] : undefined;
  const value = (mask?.params as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : MASK_PARAMS[key].default;
}

/** The element with its mask replaced: `shape` none removes it and its keyframes. */
export function withMaskShape(element: TimelineElement, shape: MaskShape): TimelineElement {
  if (!('masks' in element) && element.type !== 'video' && element.type !== 'image') return element;
  if (shape === 'none') {
    const animations = element.animations
      ? Object.fromEntries(Object.entries(element.animations).filter(([path]) => !isMaskPath(path)))
      : element.animations;
    return { ...element, masks: [], animations } as TimelineElement;
  }
  const current = 'masks' in element ? element.masks?.[0] : undefined;
  const next = buildMask(shape);
  // Changing the shape keeps where the mask was and how soft it is.
  if (current)
    next.params = {
      ...next.params,
      centerX: maskValue(element, 'centerX'),
      centerY: maskValue(element, 'centerY'),
      feather: current.params.feather,
      inverted: current.params.inverted,
    } as typeof next.params;
  return { ...element, masks: [next] } as TimelineElement;
}

/** The element with one mask param (or the invert switch) set. */
export function withMaskParam(element: TimelineElement, key: MaskKey | 'inverted', value: number | boolean): TimelineElement {
  const mask = 'masks' in element ? element.masks?.[0] : undefined;
  if (!mask) return element;
  return { ...element, masks: [{ ...mask, params: { ...mask.params, [key]: value } }] } as TimelineElement;
}
