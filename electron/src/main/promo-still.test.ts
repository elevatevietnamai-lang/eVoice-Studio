// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseStillInput,
  renderStill,
  STILL_TEMPLATES,
  stillPng,
  stillSvg,
  StillInputError,
  type StillTemplate,
} from './promo-still';

// The real bundled fonts, from the backend's assets folder.
const assetsDir = join(process.cwd(), '..', 'backend', 'assets');

const input = (template: StillTemplate, extra: Record<string, unknown> = {}) =>
  parseStillInput({
    template,
    title: 'Giảm giá mùa hè',
    subtitle: 'Chỉ trong tuần này — miễn phí giao hàng',
    badge: '-30%',
    background: '#101828',
    accent: '#ffb020',
    color: '#ffffff',
    ...extra,
  });

const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe('still images', () => {
  it.each(Object.keys(STILL_TEMPLATES) as StillTemplate[])(
    '%s draws a PNG at its size with the bundled fonts',
    async (template) => {
      const png = await stillPng(input(template), assetsDir);
      expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(pngSize(png)).toEqual(STILL_TEMPLATES[template]);
    },
    30_000,
  );

  it('draws the text as glyph paths, so no font is looked up later', async () => {
    const svg = await stillSvg(input('thumbnail'), assetsDir);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('checks every field', () => {
    expect(() => input('thumbnail', { template: 'banner' })).toThrow(StillInputError);
    expect(() => input('thumbnail', { title: '' })).toThrow(StillInputError);
    expect(() => input('thumbnail', { title: 'x'.repeat(81) })).toThrow(StillInputError);
    expect(() => input('thumbnail', { accent: 'red' })).toThrow(StillInputError);
    expect(() => input('thumbnail', { logoId: '../etc/passwd' })).toThrow(StillInputError);
    expect(() => input('thumbnail', { logoId: '0123456789abcdef.svg' })).toThrow(StillInputError);
    expect(input('thumbnail', { logoId: '0123456789abcdef.png' }).logoId).toBe(
      '0123456789abcdef.png',
    );
  });

  it('stores the PNG with the promo media over loopback', async () => {
    const calls: { url: string; body: FormData }[] = [];
    const media = await renderStill(input('square'), {
      baseUrl: 'http://127.0.0.1:1',
      headers: {},
      assetsDir,
      fetchImpl: (async (url: string, init: { body: FormData }) => {
        calls.push({ url, body: init.body });
        return new Response(JSON.stringify({ id: 'm1', kind: 'image' }), { status: 200 });
      }) as never,
    });
    expect(media.id).toBe('m1');
    expect(calls[0].url).toBe('http://127.0.0.1:1/promo/media');
    expect((calls[0].body.get('file') as File).type).toBe('image/png');
  }, 30_000);
});
