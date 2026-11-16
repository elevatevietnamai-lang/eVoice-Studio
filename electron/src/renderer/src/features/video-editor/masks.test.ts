import { describe, expect, it } from 'vitest';
import { resolveMaskAtTime } from '@/lib/opencut/mask-keyframes';
import { getMaskDefinition } from '@/lib/opencut/vendor/masks';
import { emptyProject, ticks, type EditorMedia, type EditorProject, type ElementRef } from './project';
import { maskShapeOf } from './masks';
import { baseNumber, findElementIn, hasKeyframes, insertMedia, setKeyframe, setMaskShape, setParam, splitElement } from './test-helpers';

const clip: EditorMedia = {
  id: 'm1',
  kind: 'video',
  name: 'a.mp4',
  url: '/promo/media/m1',
  duration: 4,
  width: 1920,
  height: 1080,
  has_audio: false,
};

function masked(shape: 'rectangle' | 'ellipse' | 'band'): { project: EditorProject; ref: ElementRef } {
  const placed = insertMedia(emptyProject(), clip, 0);
  return { project: setMaskShape(placed.project, placed.ref, shape), ref: placed.ref };
}

describe('masks', () => {
  it('adds a rectangle, an ellipse or a band the renderer knows', () => {
    for (const shape of ['rectangle', 'ellipse', 'band'] as const) {
      const { project, ref } = masked(shape);
      const element = findElementIn(project, ref);
      expect(maskShapeOf(element)).toBe(shape);
      const mask = 'masks' in element ? element.masks![0] : null;
      expect(getMaskDefinition(mask!.type)).toBeTruthy();
    }
  });

  it('sets position, size, softness and invert, and removes the mask', () => {
    const { project, ref } = masked('rectangle');
    let next = setParam(project, ref, 'mask.centerX', 0.25);
    next = setParam(next, ref, 'mask.feather', 40);
    next = setParam(next, ref, 'mask.inverted', true);
    const element = findElementIn(next, ref);
    expect(baseNumber(element, 'mask.centerX')).toBe(0.25);
    expect('masks' in element && element.masks![0].params).toMatchObject({ centerX: 0.25, feather: 40, inverted: true });
    // The ellipse keeps where the rectangle was.
    expect(baseNumber(findElementIn(setMaskShape(next, ref, 'ellipse'), ref), 'mask.centerX')).toBe(0.25);
    expect(maskShapeOf(findElementIn(setMaskShape(next, ref, 'none'), ref))).toBe('none');
  });

  it('animates with keyframes, resolved per frame for the renderer', () => {
    const { project, ref } = masked('rectangle');
    let next = setKeyframe(project, ref, 'mask.centerX', 0, -0.5);
    next = setKeyframe(next, ref, 'mask.centerX', 2, 0.5);
    const element = findElementIn(next, ref);
    expect(hasKeyframes(element, 'mask.centerX')).toBe(true);
    const mask = 'masks' in element ? element.masks![0] : null;
    const at = (seconds: number) => resolveMaskAtTime(mask!, element.animations, ticks(seconds)).params.centerX;
    expect(at(0)).toBeCloseTo(-0.5);
    expect(at(1)).toBeCloseTo(0);
    expect(at(2)).toBeCloseTo(0.5);
    // Removing the mask drops its keyframes too.
    expect(hasKeyframes(findElementIn(setMaskShape(next, ref, 'none'), ref), 'mask.centerX')).toBe(false);
  });

  it('keeps mask keyframes on both halves of a split', () => {
    const { project, ref } = masked('ellipse');
    let next = setKeyframe(project, ref, 'mask.width', 0, 0.2);
    next = setKeyframe(next, ref, 'mask.width', 4, 1);
    const split = splitElement(next, ref, 2);
    const [left, right] = split.project.tracks.main.elements;
    const width = (element: typeof left, seconds: number) =>
      (resolveMaskAtTime('masks' in element ? element.masks![0] : (null as never), element.animations, ticks(seconds)).params as { width: number }).width;
    expect(width(left, 1)).toBeCloseTo(0.4);
    expect(width(right, 1)).toBeCloseTo(0.8);
  });
});
