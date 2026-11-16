import { describe, expect, it } from 'vitest';
import { findMissing } from './missing-media';
import type { EditorMedia } from './project';

const media = (id: string): EditorMedia => ({
  id,
  kind: 'video',
  name: id,
  url: '/audio/promo_media/' + id,
  duration: 3,
  width: 1080,
  height: 1920,
});

describe('missing project files', () => {
  it('flags only files the engine answers 404 or 410 for', async () => {
    const status: Record<string, number> = { 'a.mp4': 200, 'b.mp4': 404, 'c.mp4': 410, 'd.mp4': 503 };
    const missing = await findMissing(Object.keys(status).map(media), async (url) => ({
      status: status[url.split('/').pop()!],
    }));
    expect([...missing].sort()).toEqual(['b.mp4', 'c.mp4']);
  });

  it('treats a failed request as present', async () => {
    const missing = await findMissing([media('a.mp4')], async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(missing.size).toBe(0);
  });
});
