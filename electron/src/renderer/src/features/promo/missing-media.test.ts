import { describe, expect, it } from 'vitest';
import { findMissing } from './missing-media';
import type { PromoMedia } from './promo-model';

const media = (id: string): PromoMedia => ({
  id,
  kind: 'video',
  name: id,
  duration: 3,
  width: 1080,
  height: 1920,
  url: '/audio/promo_media/' + id,
});

describe('findMissing', () => {
  it('flags only uploads the engine answers 404 or 410 for', async () => {
    const status: Record<string, number> = { 'a.mp4': 200, 'b.mp4': 404, 'c.mp4': 410, 'd.mp4': 503 };
    const missing = await findMissing(
      Object.keys(status).map(media),
      async (url) => ({ status: status[url.split('/').pop()!] }),
    );
    expect([...missing].sort()).toEqual(['b.mp4', 'c.mp4']);
  });

  it('treats a failed request as present, so an engine that is starting flags nothing', async () => {
    const missing = await findMissing([media('a.mp4')], async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(missing.size).toBe(0);
  });
});
