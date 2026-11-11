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
});
