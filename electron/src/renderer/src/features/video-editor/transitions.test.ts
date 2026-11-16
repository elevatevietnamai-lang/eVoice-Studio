import { describe, expect, it } from 'vitest';
import { audioSegments, gainAt } from './audio-mix';
import { emptyProject, projectSeconds, secondsOf, type EditorMedia, type EditorProject, type ElementRef } from './project';
import { deleteElement, insertMedia, setTransition, splitElement, trimElement } from './timeline-ops';
import {
  crossfadeGain,
  incoming,
  mainForRender,
  outgoing,
  placedTransitions,
  shadeOpacity,
  transitionAdjusters,
} from './transitions';

const media = (id: string, duration: number): EditorMedia => ({
  id,
  kind: 'video',
  name: `${id}.mp4`,
  url: `/promo/media/${id}`,
  duration,
  width: 1920,
  height: 1080,
  has_audio: true,
});

/** Two 4 s clips (a, b) on the main track. */
function twoClips(): { project: EditorProject; a: ElementRef; b: ElementRef } {
  const first = insertMedia(emptyProject(), media('a', 4), 0);
  const second = insertMedia(first.project, media('b', 4), 4);
  return { project: second.project, a: first.ref, b: second.ref };
}

const starts = (project: EditorProject) => project.tracks.main.elements.map((element) => secondsOf(element.startTime));

describe('transitions on the main track', () => {
  it('overlaps the clips and shortens the track by the transition', () => {
    const { project, a } = twoClips();
    expect(projectSeconds(project)).toBe(8);
    const faded = setTransition(project, a, 'fade', 1);
    expect(starts(faded)).toEqual([0, 3]);
    expect(projectSeconds(faded)).toBe(7);
    expect(placedTransitions(faded.tracks.main.elements)).toEqual([
      expect.objectContaining({ type: 'fade', start: 3, seconds: 1 }),
    ]);
    expect(projectSeconds(setTransition(faded, a, 'none', 1))).toBe(8);
  });

  it('never lasts more than half of the shorter clip', () => {
    const { project, a, b } = twoClips();
    const long = setTransition(project, a, 'fade', 2);
    const trimmed = trimElement(long, b, 'end', 2 + 1);
    // b is now 1 s long, so the overlap is at most 0.5 s.
    expect(placedTransitions(trimmed.tracks.main.elements)[0].seconds).toBe(0.5);
  });

  it('is ignored on the last clip and dropped with the clip after it', () => {
    const { project, a, b } = twoClips();
    const last = setTransition(project, b, 'fade', 1);
    expect(projectSeconds(last)).toBe(8);
    const faded = setTransition(project, a, 'fade', 1);
    expect(projectSeconds(deleteElement(faded, b))).toBe(4);
  });

  it('stays at the end of a split clip, with the right-hand part', () => {
    const { project, a } = twoClips();
    const faded = setTransition(project, a, 'push', 1);
    const split = splitElement(faded, a, 1);
    const [left, right] = split.project.tracks.main.elements;
    expect(left.params['transition.type']).toBeUndefined();
    expect(right.params['transition.type']).toBe('push');
    expect(projectSeconds(split.project)).toBe(7);
  });

  it('gives two halves of one file in a transition their own decoders', () => {
    const one = insertMedia(emptyProject(), media('a', 4), 0);
    const split = splitElement(one.project, one.ref, 2);
    const left = { trackId: 'main', elementId: split.project.tracks.main.elements[0].id };
    const faded = setTransition(split.project, left, 'fade', 0.5);
    const keys = mainForRender(faded.tracks.main, 1920).elements.map((element) => (element as { cacheKey?: string }).cacheKey);
    expect(keys).toEqual(['a#main#0', 'a#main#1']);
    // Without a transition the halves never play together and share one decoder.
    const plain = mainForRender(split.project.tracks.main, 1920).elements.map((element) => (element as { cacheKey?: string }).cacheKey);
    expect(plain).toEqual(['a#main#0', 'a#main#0']);
  });
});

describe('how a transition draws', () => {
  it('fades, slides, pushes, zooms and wipes', () => {
    expect(incoming('fade', 0, 1000)).toEqual({ opacity: 0 });
    expect(incoming('fade', 1, 1000)).toEqual({ opacity: 1 });
    expect(incoming('fade', 0.5, 1000)!.opacity).toBeCloseTo(0.5);
    expect(outgoing('fade', 0.5, 1000)).toBeNull();
    expect(incoming('slide', 0, 1000)).toEqual({ offsetX: 1000 });
    expect(incoming('push', 1, 1000)).toEqual({ offsetX: 0 });
    expect(outgoing('push', 1, 1000)).toEqual({ offsetX: -1000 });
    expect(incoming('wipe', 0.5, 1000)).toEqual({ clip: { from: 0, to: 0.5 } });
    expect(outgoing('zoom', 1, 1000)).toEqual({ scale: 1.3 });
  });

  it('passes through black: out, full black at the middle, then in', () => {
    expect(outgoing('black', 0.25, 1000)).toEqual({ opacity: 1 });
    expect(outgoing('black', 0.75, 1000)).toEqual({ opacity: 0 });
    expect(incoming('black', 0.25, 1000)).toEqual({ opacity: 0 });
    expect(incoming('black', 0.75, 1000)).toEqual({ opacity: 1 });
    expect(shadeOpacity(0)).toBe(0);
    expect(shadeOpacity(0.5)).toBe(1);
    expect(shadeOpacity(1)).toBe(0);
  });

  it('adjusts only the overlapping ends of each clip', () => {
    const { project, a, b } = twoClips();
    const faded = setTransition(project, a, 'fade', 1);
    const adjusters = transitionAdjusters(faded.tracks.main.elements, 1920);
    const out = adjusters.get(a.elementId)!;
    const into = adjusters.get(b.elementId)!;
    expect(out(1)).toBeNull();
    expect(into(0)).toEqual({ opacity: 0 });
    expect(into(0.5)!.opacity).toBeCloseTo(0.5);
    expect(into(2)).toBeNull();
  });
});

describe('sound under a transition', () => {
  it('crossfades at equal power', () => {
    expect(crossfadeGain(0, 4, 1, 0)).toBe(0);
    const half = crossfadeGain(0.5, 4, 1, 0);
    // The clip going out is at the same point of its fade, so the two powers add to one.
    expect(half ** 2 + crossfadeGain(3.5, 4, 0, 1) ** 2).toBeCloseTo(1);
    expect(crossfadeGain(2, 4, 1, 1)).toBe(1);
  });

  it('fades the two clips over the overlap in the mix', () => {
    const { project, a } = twoClips();
    const faded = setTransition(project, a, 'fade', 1);
    const [first, second] = audioSegments(faded);
    expect(first).toMatchObject({ start: 0, crossOut: 1, crossIn: 0 });
    expect(second).toMatchObject({ start: 3, crossIn: 1, crossOut: 0 });
    expect(gainAt(second, 0)).toBe(0);
    expect(gainAt(first, 4 - 1e-9)).toBeCloseTo(0);
    expect(gainAt(first, 2)).toBe(1);
  });

  it('leaves projects without transitions as they were', () => {
    const { project } = twoClips();
    for (const segment of audioSegments(project)) expect(segment).toMatchObject({ crossIn: 0, crossOut: 0 });
  });
});
