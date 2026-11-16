import { describe, expect, it } from 'vitest';
import { emptyProject } from '../project';
import { addSticker, setStickerId } from '../timeline-ops';
import {
  STICKER_GROUPS,
  STICKER_SIZE,
  isRecolorable,
  parseStickerId,
  stickerId,
  stickerSvg,
  stickerUrl,
  stickersIn,
} from './library';

const all = STICKER_GROUPS.flatMap((group) => stickersIn(group));

describe('bundled stickers', () => {
  it('has shapes, arrows, frames and emoji', () => {
    for (const group of STICKER_GROUPS) expect(stickersIn(group).length).toBeGreaterThanOrEqual(4);
  });

  it('draws every sticker as a well-formed SVG at full size, with nothing fetched', () => {
    for (const name of all) {
      const svg = stickerSvg(stickerId(name))!;
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror'), name).toBeNull();
      expect(doc.documentElement.getAttribute('width')).toBe(String(STICKER_SIZE));
      // The only URL is the SVG namespace: no image, font or stylesheet links.
      expect(svg.match(/https?:\/\/[^"]+/g)).toEqual(['http://www.w3.org/2000/svg']);
      expect(svg).not.toMatch(/<image|href=|@import|url\(\s*['"]?http/);
      expect(stickerUrl(stickerId(name))).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    }
  });

  it('recolours drawn stickers but not emoji', () => {
    expect(stickerId('star', '#FF0000')).toBe('evoice:star:ff0000');
    expect(stickerSvg('evoice:star:ff0000')).toContain('color="#ff0000"');
    expect(isRecolorable('evoice:star')).toBe(true);
    expect(stickerId('emoji-fire', '#ff0000')).toBe('evoice:emoji-fire');
    expect(isRecolorable('evoice:emoji-fire')).toBe(false);
  });

  it('refuses ids it does not ship', () => {
    expect(parseStickerId('evoice:nope')).toBeNull();
    expect(parseStickerId('icons:mdi:home')).toBeNull();
    expect(stickerUrl('https://example.com/x.svg')).toBeNull();
  });

  it('adds a sticker on its own track at the playhead, a third of the frame', () => {
    const { project, ref } = addSticker(emptyProject(), 2, stickerId('heart'), 'Shapes 6');
    const track = project.tracks.overlay.find((item) => item.id === ref.trackId)!;
    expect(track.type).toBe('graphic');
    const [sticker] = track.elements;
    expect(sticker).toMatchObject({ type: 'sticker', stickerId: 'evoice:heart', startTime: 240_000 });
    expect(sticker.params['transform.scaleX']).toBe(0.35);
    const recoloured = setStickerId(project, ref, stickerId('heart', '#00ff00'));
    expect(recoloured.tracks.overlay[0].elements[0]).toMatchObject({ stickerId: 'evoice:heart:00ff00' });
  });
});
