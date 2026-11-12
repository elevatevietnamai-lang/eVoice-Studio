import { describe, expect, it } from 'vitest';
import { beatSyncActive, musicOffset, NO_GRID } from './beat-grid';
import { emptyDraft, shotFor, type PromoMedia } from './promo-model';

const clip: PromoMedia = {
  id: '0123456789abcdef.mp4',
  kind: 'video',
  name: 'a.mp4',
  duration: 8,
  width: 1080,
  height: 1920,
  url: '/audio/promo_media/0123456789abcdef.mp4',
};
const music: PromoMedia = { ...clip, id: 'aaaaaaaaaaaaaaaa.mp3', kind: 'audio' };
const grid = { period: 0.52, phase: 0.51 };

describe('beat grid', () => {
  it('starts the music on a beat only when the render will snap', () => {
    const draft = { ...emptyDraft(), music, snapToBeats: true };
    draft.shots = [shotFor(clip, 'a'), shotFor(clip, 'b')];
    expect(beatSyncActive(draft, grid)).toBe(true);
    expect(musicOffset(draft, grid)).toBe(0.51);
    // Same conditions as the router: snapping on, music, a grid, two shots.
    expect(musicOffset({ ...draft, snapToBeats: false }, grid)).toBe(0);
    expect(musicOffset(draft, NO_GRID)).toBe(0);
    expect(musicOffset({ ...draft, shots: draft.shots.slice(0, 1) }, grid)).toBe(0);
    expect(musicOffset({ ...draft, music: null }, grid)).toBe(0);
  });
});
