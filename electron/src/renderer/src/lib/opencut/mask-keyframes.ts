/**
 * Keyframed masks: a mask param `key` animates on the element's own
 * animations under the path `mask.<key>`, and is resolved for the frame
 * being drawn before the mask is rasterised (so the texture hash carries it).
 * (eVoice Studio addition to the vendored OpenCut renderer.)
 */
import { registerDefaultMasks } from './vendor/masks';
import { resolveNumberAtTime } from './vendor/animation/values';
import type { ElementAnimations } from './vendor/animation/types';
import type { Mask } from './vendor/masks/types';

// The built-in shapes (rectangle, ellipse, bars...) register on first use.
registerDefaultMasks();

export const MASK_PATH_PREFIX = 'mask.';

/** The mask with every keyframed param at `localTime` (ticks into the clip). */
export function resolveMaskAtTime<T extends Mask>(mask: T, animations: ElementAnimations | undefined, localTime: number): T {
  if (!animations) return mask;
  const params: Record<string, unknown> = { ...mask.params };
  for (const [key, value] of Object.entries(mask.params)) {
    if (typeof value !== 'number') continue;
    params[key] = resolveNumberAtTime({
      baseValue: value,
      animations,
      propertyPath: `${MASK_PATH_PREFIX}${key}` as never,
      localTime,
    });
  }
  return { ...mask, params } as T;
}
