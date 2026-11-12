import { describe, expect, it } from 'vitest';
import {
  DRAFT_KEY,
  emptyDraft,
  loadDraft,
  moveShot,
  programLength,
  renderRequest,
  saveDraft,
  shotFor,
  draftProblem,
  MAX_OVERLAYS,
  overlayProblem,
  timeline,
  SHAPE_SIZE,
  type PromoMedia,
} from './promo-model';

const video: PromoMedia = {
  id: '0123456789abcdef.mp4',
  kind: 'video',
  name: 'a.mp4',
  duration: 8,
  width: 1920,
  height: 1080,
  url: '/audio/promo_media/0123456789abcdef.mp4',
};
const image: PromoMedia = { ...video, id: 'fedcba9876543210.png', kind: 'image', duration: null };

describe('promo model', () => {
  it('matches the backend timeline: each transition overlaps two shots', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), shotFor(image, 'b'), shotFor(video, 'c')];
    draft.shots[2].transition = 'cut';
    // 3 + 2.5 - 0.5 (fade) + 3 (cut)
    expect(programLength(draft)).toBeCloseTo(8);
  });

  it('adds the logo ending only with a logo', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a')];
    draft.outroSeconds = 3;
    expect(programLength(draft)).toBeCloseTo(3);
    draft.logo = { ...image, id: 'aaaaaaaaaaaaaaaa.png' };
    expect(programLength(draft)).toBeCloseTo(3 + 3 - 0.6);
  });

  it('caps a transition at 45 % of the shorter shot', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), { ...shotFor(video, 'b'), duration: 1 }];
    draft.shots[1].transitionSeconds = 2;
    expect(programLength(draft)).toBeCloseTo(3 + 1 - 0.45);
  });

  it('builds the render request with ids, not paths', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), shotFor(image, 'b')];
    draft.watermark = 'top_left';
    const body = renderRequest(draft);
    expect(body.shots.map((shot) => shot.media_id)).toEqual([video.id, image.id]);
    expect(body.shots[0].motion).toBe('none');
    expect(body.shots[1].motion).toBe('zoom_in');
    // No logo: no watermark and no ending.
    expect(body.watermark).toBe('none');
    expect(body.outro_seconds).toBe(0);
    expect(body.snap_to_beats).toBe(false);
  });

  it('reports why a draft cannot render', () => {
    const draft = emptyDraft();
    expect(draftProblem(draft)).toBe('empty');
    draft.shots = Array.from({ length: 6 }, (_, i) => ({
      ...shotFor(video, String(i)),
      duration: 60,
      transition: 'cut' as const,
    }));
    expect(draftProblem(draft)).toBe('too_long');
  });

  it('moves shots within bounds', () => {
    const shots = [shotFor(video, 'a'), shotFor(image, 'b')];
    expect(moveShot(shots, 0, 1).map((shot) => shot.key)).toEqual(['b', 'a']);
    expect(moveShot(shots, 0, -1)).toBe(shots);
  });

  it('round-trips the draft and survives bad storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a')];
    draft.shape = 'square';
    saveDraft(draft, storage);
    expect(loadDraft(storage).shape).toBe('square');
    expect(loadDraft(storage).shots[0].media.id).toBe(video.id);
    store.set(DRAFT_KEY, '{not json');
    expect(loadDraft(storage)).toEqual(emptyDraft());
    store.set(DRAFT_KEY, JSON.stringify({ shape: 'round', fps: 24, look: 'sepia' }));
    const repaired = loadDraft(storage);
    expect([repaired.shape, repaired.fps, repaired.look]).toEqual(['vertical', 30, 'none']);
  });

  it('sends animated overlays with their start, capped like the backend', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a')];
    const overlay = { ...video, id: 'aaaaaaaaaaaaaaaa.webm', name: 'overlay.webm' };
    draft.overlays = Array.from({ length: MAX_OVERLAYS + 3 }, (_, index) => ({
      key: `o${index}`,
      media: overlay,
      start: index === 0 ? -2 : index,
      label: 'SALE',
    }));
    const body = renderRequest(draft);
    expect(body.overlays).toHaveLength(MAX_OVERLAYS);
    expect(body.overlays[0]).toEqual({ media_id: overlay.id, start: 0 });
    expect(body.overlays[1]).toEqual({ media_id: overlay.id, start: 1 });
    expect(renderRequest(emptyDraft()).overlays).toEqual([]);
  });

  it('keeps only well-formed saved overlays', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null };
    const good = { key: 'a', media: video, start: 1.5, label: 'SALE' };
    store.set(
      DRAFT_KEY,
      JSON.stringify({
        overlays: [good, { key: 'b', start: 'x' }, null, { ...good, media: null }],
      }),
    );
    expect(loadDraft(storage).overlays).toEqual([good]);
    store.set(DRAFT_KEY, JSON.stringify({ overlays: 'nope' }));
    expect(loadDraft(storage).overlays).toEqual([]);
  });

  it('sizes overlays like the backend output', () => {
    expect(SHAPE_SIZE.vertical).toEqual({ width: 1080, height: 1920 });
    expect(SHAPE_SIZE.landscape).toEqual({ width: 1920, height: 1080 });
  });

  it('anchors overlays to shots by key, so reordering carries them along', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), shotFor(video, 'b'), shotFor(video, 'c')];
    const media = { ...video, id: 'aaaaaaaaaaaaaaaa.webm' };
    draft.overlays = [
      { key: 'o1', media, start: 0.4, label: 'X', shotKey: 'c' },
      { key: 'o2', media, start: 2, label: 'Y' },
    ];
    expect(renderRequest(draft).overlays).toEqual([
      { media_id: media.id, start: 0.4, shot: 2 },
      { media_id: media.id, start: 2 },
    ]);
    draft.shots = moveShot(draft.shots, 2, -1);
    expect(renderRequest(draft).overlays[0]).toEqual({ media_id: media.id, start: 0.4, shot: 1 });
  });

  it('flags an overlay whose shot was removed or that starts after the end', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), shotFor(video, 'b')];
    const media = { ...video, id: 'aaaaaaaaaaaaaaaa.webm' };
    const { starts, length } = timeline(draft);
    expect(starts[0]).toBe(0);
    expect(
      overlayProblem(draft, { key: 'o', media, start: 0.1, label: '', shotKey: 'b' }),
    ).toBeNull();
    expect(overlayProblem(draft, { key: 'o', media, start: 0, label: '', shotKey: 'gone' })).toBe(
      'shot_removed',
    );
    expect(overlayProblem(draft, { key: 'o', media, start: length + 1, label: '' })).toBe(
      'after_end',
    );
    expect(
      overlayProblem(draft, {
        key: 'o',
        media,
        start: length - starts[1],
        label: '',
        shotKey: 'b',
      }),
    ).toBe('after_end');
    const fallback = renderRequest({
      ...draft,
      overlays: [{ key: 'o', media, start: 1, label: '', shotKey: 'gone' }],
    }).overlays[0];
    expect(fallback).toEqual({ media_id: media.id, start: 1 });
  });

  it('flags overlays that are on screen at the same time', () => {
    const draft = emptyDraft();
    draft.shots = [shotFor(video, 'a'), shotFor(video, 'b')];
    const media = { ...video, id: 'aaaaaaaaaaaaaaaa.webm', duration: 1.5 };
    const first = { key: 'o1', media, start: 0, label: '' };
    const second = { key: 'o2', media, start: 0.8, label: '' };
    const later = { key: 'o3', media, start: 0, label: '', shotKey: 'b' };
    draft.overlays = [first, second, later];
    expect(overlayProblem(draft, first)).toBe('overlaps');
    expect(overlayProblem(draft, second)).toBe('overlaps');
    // Shot b starts at 3 s, after both have ended.
    expect(overlayProblem(draft, later)).toBeNull();
    // Starting during the last half second (the fade-out) is a hand-over.
    draft.overlays = [first, { ...second, start: 1.2 }];
    expect(overlayProblem(draft, first)).toBeNull();
  });
});
