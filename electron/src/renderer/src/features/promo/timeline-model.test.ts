import { describe, expect, it } from 'vitest';
import fixtures from './snap-fixtures.json';
import {
  emptyDraft,
  MAX_PROGRAM_SECONDS,
  MAX_SHOT_SECONDS,
  MAX_SHOTS,
  MAX_TRANSITION_SECONDS,
  MIN_SHOT_SECONDS,
  renderRequest,
  shotFor,
  timeline,
  type PromoDraft,
  type PromoMedia,
} from './promo-model';
import {
  beatTimes,
  layoutTimeline,
  maxDuration,
  moveOverlay,
  moveShotTo,
  overlayStart,
  record,
  redo,
  removeShot,
  resizeShot,
  shotAt,
  snap,
  snapToBeats,
  splitShotAt,
  trimShotStart,
  undo,
} from './timeline-model';

const clip: PromoMedia = {
  id: '0123456789abcdef.mp4',
  kind: 'video',
  name: 'a.mp4',
  duration: 8,
  width: 1080,
  height: 1920,
  url: '/audio/promo_media/0123456789abcdef.mp4',
};
const still: PromoMedia = { ...clip, id: 'fedcba9876543210.png', kind: 'image', duration: null };
const badge: PromoMedia = { ...clip, id: 'aaaaaaaaaaaaaaaa.webm', duration: 1.5 };

/** a 3 s cut, b 2 s fading in over 0.5 s, c 2.5 s still cut in. */
function draft(): PromoDraft {
  const value = emptyDraft();
  value.shots = [
    { ...shotFor(clip, 'a'), duration: 3, transition: 'cut' },
    { ...shotFor(clip, 'b'), duration: 2, transition: 'fade', transitionSeconds: 0.5 },
    { ...shotFor(still, 'c'), duration: 2.5, transition: 'cut' },
  ];
  value.overlays = [
    { key: 'o1', media: badge, start: 0.5, label: 'one', shotKey: 'b' },
    { key: 'o2', media: badge, start: 0.2, label: 'two', shotKey: 'b' },
    { key: 'o3', media: badge, start: 6.8, label: 'three', shotKey: null },
  ];
  return value;
}

/** What the backend refuses (services/promo_video.py validate_plan). */
function assertRenderable(value: PromoDraft) {
  const body = renderRequest(value);
  expect(body.shots.length).toBeLessThanOrEqual(MAX_SHOTS);
  for (const shot of body.shots) {
    expect(shot.duration).toBeGreaterThanOrEqual(MIN_SHOT_SECONDS);
    expect(shot.duration).toBeLessThanOrEqual(MAX_SHOT_SECONDS);
    expect(shot.start).toBeGreaterThanOrEqual(0);
    expect(shot.transition_seconds).toBeLessThanOrEqual(MAX_TRANSITION_SECONDS);
  }
  expect(timeline(value).length).toBeLessThanOrEqual(MAX_PROGRAM_SECONDS);
  for (const overlay of body.overlays) {
    expect(overlay.start).toBeGreaterThanOrEqual(0);
    if ('shot' in overlay) expect(overlay.shot).toBeLessThan(body.shots.length);
  }
}

describe('layoutTimeline', () => {
  it('places shots where the backend starts them, transitions overlapping', () => {
    const layout = layoutTimeline(draft());
    expect(layout.shots.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [2.5, 4.5],
      [4.5, 7],
    ]);
    expect(layout.length).toBe(7);
    expect(layout.outro).toBeNull();
  });

  it('stacks overlapping overlays in lanes and resolves anchors', () => {
    const layout = layoutTimeline(draft());
    const byKey = Object.fromEntries(layout.overlays.map((o) => [o.key, o]));
    expect(byKey.o1.start).toBe(3);
    expect(byKey.o2.start).toBe(2.7);
    expect(byKey.o1.lane).not.toBe(byKey.o2.lane);
    expect(byKey.o3.problem).toBeNull();
    expect(layout.lanes).toBe(2);
  });

  it('shows the logo ending as its own block', () => {
    const value = { ...draft(), logo: still, outroSeconds: 2 };
    const layout = layoutTimeline(value);
    expect(layout.outro).toEqual({ start: 6.4, end: layout.length });
  });
});

describe('shotAt', () => {
  it('gives a transition to the incoming shot and nothing past the end', () => {
    const value = draft();
    expect(shotAt(value, 0)).toBe(0);
    expect(shotAt(value, 2.49)).toBe(0);
    expect(shotAt(value, 2.5)).toBe(1);
    expect(shotAt(value, 6.99)).toBe(2);
    expect(shotAt(value, 7)).toBe(-1);
    expect(shotAt({ ...value, logo: still, outroSeconds: 2 }, 6.5)).toBe(-1);
  });
});

describe('edits', () => {
  it('resizes within the limits and the clip', () => {
    expect(resizeShot(draft(), 'a', 0.1).shots[0].duration).toBe(MIN_SHOT_SECONDS);
    expect(resizeShot(draft(), 'a', 20).shots[0].duration).toBe(8);
    expect(resizeShot(draft(), 'c', 99).shots[2].duration).toBe(MAX_SHOT_SECONDS);
    expect(maxDuration({ ...draft().shots[0], start: 6 })).toBe(3);
  });

  it('trims the start of a video and keeps its end', () => {
    const trimmed = trimShotStart(draft(), 'a', 1.2).shots[0];
    expect([trimmed.start, trimmed.duration]).toEqual([1.2, 1.8]);
    expect(trimShotStart(draft(), 'a', -5).shots[0].start).toBe(0);
    const tight = trimShotStart(draft(), 'a', 2.9).shots[0];
    expect(tight.duration).toBe(MIN_SHOT_SECONDS);
    expect(trimShotStart(draft(), 'c', 1).shots[2]).toEqual(draft().shots[2]);
  });

  it('reorders and carries anchored overlays along', () => {
    const value = moveShotTo(draft(), 'b', 0);
    expect(value.shots.map((s) => s.key)).toEqual(['b', 'a', 'c']);
    expect(overlayStart(value, value.overlays[0])).toBe(0.5);
    expect(renderRequest(value).overlays[0]).toEqual({ media_id: badge.id, start: 0.5, shot: 0 });
  });

  it('splits at the playhead into a cut that continues the clip', () => {
    const before = draft();
    before.overlays[0] = { ...before.overlays[0], start: 1.5 };
    // b starts at 2.5 s; split 1.2 s into it.
    const value = splitShotAt(before, 3.7, 'b2');
    expect(value.shots.map((s) => [s.key, s.start, s.duration, s.transition])).toEqual([
      ['a', 0, 3, 'cut'],
      ['b', 0, 1.2, 'fade'],
      ['b2', 1.2, 0.8, 'cut'],
      ['c', 0, 2.5, 'cut'],
    ]);
    // o1 sat 1.5 s into b, so it moves to the new half; o2 stays on b.
    const [o1, o2] = value.overlays;
    expect([o1.shotKey, o1.start, o2.shotKey, o2.start]).toEqual(['b2', 0.3, 'b', 0.2]);
    expect(overlayStart(value, o1)).toBe(overlayStart(before, before.overlays[0]));
    expect(timeline(value).length).toBe(timeline(before).length);
    expect(splitShotAt(draft(), 0.2, 'x')).toEqual(draft());
    expect(splitShotAt(draft(), 9, 'x')).toEqual(draft());
  });

  it('refuses a split that would shrink a transition and move later cuts', () => {
    // 0.5 s into b leaves 0.5 s for a 0.5 s fade; the clamp would cut it to 0.225 s.
    expect(splitShotAt(draft(), 3.0, 'b2')).toEqual(draft());
  });

  it('re-anchors a dropped overlay to the shot under it, or the video start on the ending', () => {
    const onC = moveOverlay(draft(), 'o3', 5);
    expect(onC.overlays[2]).toMatchObject({ shotKey: 'c', start: 0.5 });
    const value = { ...draft(), logo: still, outroSeconds: 2 };
    expect(moveOverlay(value, 'o1', 7).overlays[0]).toMatchObject({ shotKey: null, start: 7 });
    expect(moveOverlay(value, 'o1', -3).overlays[0]).toMatchObject({ shotKey: 'a', start: 0 });
  });

  it('keeps every edit renderable', () => {
    let value = draft();
    const edits: ((d: PromoDraft) => PromoDraft)[] = [
      (d) => resizeShot(d, 'a', 0),
      (d) => resizeShot(d, 'b', 999),
      (d) => trimShotStart(d, 'b', 7.9),
      (d) => splitShotAt(d, 1, 'n1'),
      (d) => moveShotTo(d, 'c', -4),
      (d) => moveOverlay(d, 'o2', 1e6),
      (d) => moveOverlay(d, 'o1', 0.3),
      (d) => removeShot(d, 'a'),
      (d) => splitShotAt(d, 0.6, 'n2'),
    ];
    for (const edit of edits) {
      value = edit(value);
      assertRenderable(value);
    }
  });

  it('stops splitting at the shot limit', () => {
    const value = draft();
    value.shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({
      ...shotFor(clip, `s${i}`),
      duration: 2,
    }));
    expect(splitShotAt(value, 1, 'x').shots).toHaveLength(MAX_SHOTS);
  });
});

describe('beats and snapping', () => {
  it('lists beats from 0 and snaps within the tolerance', () => {
    expect(beatTimes(0.5, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(beatTimes(0, 10)).toEqual([]);
    expect(snap(1.07, [0.5, 1, 1.5], 0.1)).toBe(1);
    expect(snap(1.2, [0.5, 1, 1.5], 0.1)).toBe(1.2);
  });
});

describe('history', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const a = draft();
    const b = resizeShot(a, 'a', 2);
    const c = resizeShot(b, 'a', 1);
    let history = record(record({ past: [], future: [] }, a), b);
    const back = undo(history, c)!;
    expect(back.draft).toBe(b);
    const forward = redo(back.history, back.draft)!;
    expect(forward.draft).toBe(c);
    history = record(back.history, b);
    expect(history.future).toEqual([]);
    expect(undo({ past: [], future: [] }, a)).toBeNull();
  });
});

describe('snapToBeats', () => {
  // Expected values come from services/promo_video.py snap_to_beats on the same plans.
  it('matches the backend', () => {
    const lengths = (period: number, value = draft()) =>
      snapToBeats(value, period).shots.map((shot) => shot.duration);
    expect(lengths(0.5)).toEqual([3, 2, 2.5]);
    expect(lengths(0.37)).toEqual([3.09, 1.85, 2.5]);
    const mixed = emptyDraft();
    mixed.shots = [
      { ...shotFor(clip, 'a'), duration: 1.2, transition: 'cut' },
      { ...shotFor(clip, 'b'), duration: 0.7, transition: 'slide', transitionSeconds: 0.6 },
      { ...shotFor(still, 'c'), duration: 1.9, transition: 'fade', transitionSeconds: 0.4 },
      { ...shotFor(clip, 'd'), duration: 2, transition: 'cut' },
    ];
    expect(lengths(0.522, mixed)).toEqual([1.459, 0.922, 1.566, 2]);
  });

  // scripts/export_promo_snap_fixtures.py records the backend on 40 random
  // plans, every transition and many clamps; the port must agree exactly.
  it.each(fixtures.map((fixture, index) => [index, fixture] as const))(
    'agrees with the backend on random plan %i',
    (_index, fixture) => {
      const value = emptyDraft();
      value.shots = fixture.shots.map((shot, k) => ({
        ...shotFor(clip, `k${k}`),
        duration: shot.duration,
        transition: shot.transition as PromoDraft['shots'][number]['transition'],
        transitionSeconds: shot.transitionSeconds,
      }));
      const once = snapToBeats(value, fixture.period);
      expect(once.shots.map((shot) => shot.duration)).toEqual(fixture.snapped);
      expect(snapToBeats(once, fixture.period).shots.map((shot) => shot.duration)).toEqual(
        fixture.again,
      );
      expect(fixture.again).toEqual(fixture.snapped);
    },
  );

  it('is stable, so the render leaves a snapped timeline alone', () => {
    const once = snapToBeats(draft(), 0.37);
    expect(snapToBeats(once, 0.37)).toBe(once);
    expect(snapToBeats(draft(), 0)).toEqual(draft());
  });
});
