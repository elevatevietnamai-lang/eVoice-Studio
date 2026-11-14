// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  blocking,
  exportScene,
  importScene,
  lintScene,
  MAX_SCENE_CODE_BYTES,
  parseScene,
  SCENE_CSP,
  sceneDocument,
  SceneInputError,
  SceneStore,
  sceneToHtml,
  splitHtml,
  usedFontFamilies,
  type PromoScene,
  type SceneContext,
} from './promo-scenes';
import { writeZip } from './promo-zip';

const base = (patch: Partial<PromoScene> = {}): PromoScene =>
  parseScene({
    id: null,
    name: 'Sale',
    html: '<h1 class="t">{{title}}</h1>',
    css: '.t{color:{{accent}};font:900 80px/1 "Inter"}',
    js: 'scene.onFrame(function(t){document.title=String(t)})',
    params: [
      { key: 'title', type: 'text', label: 'Title', value: 'Hello' },
      { key: 'accent', type: 'color', label: 'Accent', value: '#FF0000' },
    ],
    assets: [],
    duration: 3,
    ...patch,
  });

const context: SceneContext = {
  width: 1080,
  height: 1920,
  mode: 'render',
  fontUri: (id) => `data:font/ttf;base64,${id}`,
  images: new Map(),
};

function field(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SceneInputError) return error.field;
    throw error;
  }
  return 'none';
}

describe('parseScene', () => {
  it('normalizes a valid scene', () => {
    const scene = base();
    expect(scene.params[1].value).toBe('#ff0000');
    expect(scene.duration).toBe(3);
    expect(scene.id).toBeNull();
  });

  it.each([
    ['name', { name: '' }],
    ['duration', { duration: 0.2 }],
    ['duration', { duration: 61 }],
    ['html', { html: 'x'.repeat(MAX_SCENE_CODE_BYTES + 1) }],
    ['id', { id: '../../etc' }],
    ['params', { params: [{ key: 'Bad Key', type: 'text', value: '' }] }],
    ['params', { params: [{ key: 'width', type: 'text', value: '' }] }],
    ['params', { params: [{ key: 'a', type: 'script', value: '' }] }],
    ['param:c', { params: [{ key: 'c', type: 'color', value: 'red;}body{x' }] }],
    ['param:i', { params: [{ key: 'i', type: 'image', value: '../secret.png' }] }],
    ['param:i', { params: [{ key: 'i', type: 'image', value: 'file:///C:/x.png' }] }],
    ['assets', { assets: [{ name: '../x.png', data: 'AA==' }] }],
    ['assets', { assets: [{ name: 'x.exe', data: 'AA==' }] }],
    ['assets', { assets: [{ name: 'x.png', data: 'not base64!' }] }],
  ])('refuses bad %s', (expected, patch) => {
    expect(field(() => base(patch as Partial<PromoScene>))).toBe(expected);
  });

  it('accepts an image param pointing at a bundled asset or a promo media id', () => {
    const scene = base({
      assets: [{ name: 'logo.png', data: 'iVBORw0KGgo=' }],
      params: [
        { key: 'a', type: 'image', label: 'a', value: 'asset:logo.png' },
        { key: 'b', type: 'image', label: 'b', value: '0123456789abcdef.png' },
      ],
    });
    expect(scene.params.map((p) => p.value)).toEqual(['asset:logo.png', '0123456789abcdef.png']);
  });
});

describe('sceneDocument', () => {
  it('puts the no-network policy before any scene text', () => {
    const scene = base({
      html: '<meta http-equiv="Content-Security-Policy" content="default-src *">{{title}}',
      css: '</style><meta http-equiv="refresh" content="0;url=https://x.example">',
    });
    const page = sceneDocument(scene, context);
    const policy = page.indexOf(`content="${SCENE_CSP}"`);
    expect(policy).toBeGreaterThan(0);
    // Nothing the scene wrote comes before the policy.
    expect(page.indexOf('default-src *')).toBeGreaterThan(policy);
    expect(page.slice(0, policy)).not.toMatch(/http-equiv="refresh"|<script/);
    // The policy itself allows no connection, frame or remote load.
    expect(SCENE_CSP).toContain("connect-src 'none'");
    expect(SCENE_CSP).toContain("default-src 'none'");
    expect(SCENE_CSP).toContain("frame-src 'none'");
    expect(SCENE_CSP).toContain("base-uri 'none'");
    expect(SCENE_CSP).not.toMatch(/https?:|file:|'self'|\*/);
    // The CSS cannot close its <style> element.
    expect(page).not.toContain('</style><meta http-equiv="refresh"');
  });

  it('escapes text params in HTML and keeps them out of CSS', () => {
    const scene = base({
      html: '<p>{{title}}</p>',
      css: 'p::after{content:"{{title}}"} p{color:{{accent}}}',
      params: [
        { key: 'title', type: 'text', label: 't', value: '<img src=x onerror=alert(1)>"' },
        { key: 'accent', type: 'color', label: 'a', value: '#00ff00' },
      ],
    });
    const page = sceneDocument(scene, context);
    expect(page).toContain('<p>&lt;img src=x onerror=alert(1)&gt;&quot;</p>');
    expect(page).toContain('p::after{content:""} p{color:#00ff00}');
  });

  it('gives scripts the params as data that cannot close the script', () => {
    const scene = base({
      params: [{ key: 'title', type: 'text', label: 't', value: '</script><b>x' }],
      js: 'var s = "</script>";',
    });
    const page = sceneDocument(scene, context);
    expect(page).toContain('\\u003c/script>\\u003cb>x');
    expect(page).toContain('var s = "<\\/script>";');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
  });

  it('inlines bundled assets and only the fonts the scene uses', () => {
    const scene = base({
      html: '<img src="assets/logo.png"><img src="assets/missing.png">',
      assets: [{ name: 'logo.png', data: 'iVBORw0KGgo=' }],
    });
    const page = sceneDocument(scene, context);
    expect(page).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(page).toContain('src="assets/missing.png"');
    expect(page).toContain('font-family:"Inter"');
    expect(page).not.toContain('font-family:"Oswald"');
  });

  it('drives hf-seek only in the preview', () => {
    expect(sceneDocument(base(), context)).not.toContain('promoScene');
    expect(sceneDocument(base(), { ...context, mode: 'preview' })).toContain(
      "postMessage({promoScene:'alive'}",
    );
  });

  it('drops SVG namespace URIs, which name no resource', () => {
    const scene = base({
      html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
    });
    expect(lintScene(scene)).toEqual([]);
    expect(sceneDocument(scene, context)).not.toContain('http://www.w3.org');
  });
});

describe('lintScene', () => {
  it('flags remote URLs, @import and fonts that are not bundled', () => {
    const scene = base({
      html: '<img src="https://cdn.example/a.png">',
      css: '@import url(x.css); .a{font-family: Arial, sans-serif} .b{font: 700 2em/1 "Oswald"}',
    });
    const codes = lintScene(scene).map((p) => p.code);
    expect(codes).toEqual(['remote_url', 'css_import', 'unknown_font']);
    expect(lintScene(scene).find((p) => p.code === 'unknown_font')).toMatchObject({
      detail: 'Arial',
    });
  });

  it('accepts a font the scene declares itself', () => {
    const scene = base({
      css: '@font-face{font-family:"Brand";src:url(assets/brand.woff2)} h1{font-family:"Brand"}',
    });
    expect(lintScene(scene)).toEqual([]);
  });

  it('warns, without blocking, about timer-driven animation', () => {
    const problems = lintScene(base({ js: 'requestAnimationFrame(step)' }));
    expect(problems.map((p) => p.code)).toEqual(['timer_animation']);
    expect(blocking(problems)).toEqual([]);
  });

  it('reads families from the font shorthand and inline styles', () => {
    expect(usedFontFamilies('a{font: italic 600 3rem/1.2 "Dancing Script", cursive}')).toEqual([
      'Dancing Script',
      'cursive',
    ]);
    expect(usedFontFamilies('<p style="font-family: Helvetica">')).toEqual(['Helvetica']);
  });
});

describe('import and export', () => {
  it('round-trips a scene through the single-file form', () => {
    const scene = base();
    const back = importScene('sale.html', new Uint8Array(Buffer.from(sceneToHtml(scene))));
    expect(back).toMatchObject({
      name: 'Sale',
      html: scene.html,
      css: scene.css,
      js: scene.js,
      params: scene.params,
      duration: 3,
      id: null,
    });
  });

  it('round-trips a scene with files through a zip', () => {
    const scene = base({
      html: '<img src="assets/logo.png">',
      assets: [{ name: 'logo.png', data: 'iVBORw0KGgo=' }],
    });
    const file = exportScene(scene);
    expect(file.extension).toBe('zip');
    expect(importScene('x.zip', file.data).assets).toEqual(scene.assets);
  });

  it('splits a plain page into markup, style and script', () => {
    const parts = splitHtml(`<!doctype html><html><head><title>t</title>
      <link rel="stylesheet" href="https://x.example/a.css"><style>h1{color:red}</style>
      <script src="https://x.example/a.js"></script></head>
      <body><h1>Hi</h1><script>console.log(1)</script></body></html>`);
    expect(parts.html).toBe('<h1>Hi</h1>');
    expect(parts.css).toBe('h1{color:red}');
    expect(parts.js).toBe('console.log(1)');
  });

  it('never reads a zip entry outside the scene layout', () => {
    const zip = writeZip(
      new Map([
        ['index.html', new Uint8Array(Buffer.from('<p>x</p>'))],
        ['other/notes.txt', new Uint8Array(Buffer.from('ignored'))],
        ['assets/a.png', new Uint8Array([1])],
      ]),
    );
    const scene = importScene('x.zip', zip);
    expect(scene.assets.map((a) => a.name)).toEqual(['a.png']);
    expect(scene.html).toBe('<p>x</p>');
  });

  it('refuses executable assets, archives without an index and unknown types', () => {
    const exe = writeZip(
      new Map([
        ['index.html', new Uint8Array(Buffer.from('<p>x</p>'))],
        ['assets/run.exe', new Uint8Array([1])],
      ]),
    );
    expect(field(() => importScene('x.zip', exe))).toBe('zip:asset_type');
    const empty = writeZip(new Map([['a.txt', new Uint8Array([1])]]));
    expect(field(() => importScene('x.zip', empty))).toBe('zip:no_index');
    expect(field(() => importScene('x.exe', new Uint8Array([1])))).toBe('file_type');
    expect(field(() => importScene('x.html', new Uint8Array([0xff, 0xfe, 0xfd])))).toBe('html');
  });

  it('refuses a zip with a traversal entry', () => {
    // writeZip refuses unsafe names, so patch one in after writing.
    const zip = Buffer.from(
      writeZip(
        new Map([
          ['index.html', new Uint8Array(Buffer.from('<p>x</p>'))],
          ['zz/evil.png', new Uint8Array([1])],
        ]),
      ),
    );
    zip.write('..', zip.indexOf('zz/evil.png', zip.indexOf('PK\u0001\u0002')), 'latin1');
    expect(field(() => importScene('x.zip', new Uint8Array(zip)))).toBe('zip:unsafe_name');
  });
});

describe('SceneStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'promo-scenes-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('saves, lists, reads back and removes scenes under generated names', () => {
    const store = new SceneStore(dir);
    const saved = store.save(base());
    expect(saved.id).toMatch(/^[0-9a-f]{16}$/);
    expect(readdirSync(dir)).toEqual([`${saved.id}.json`]);
    expect(store.list()).toMatchObject([{ id: saved.id, name: 'Sale', duration: 3 }]);
    expect(store.get(saved.id!)).toEqual(saved);
    store.save({ ...saved, name: 'Renamed' });
    expect(store.list()).toHaveLength(1);
    store.remove(saved.id!);
    expect(store.list()).toEqual([]);
  });

  it('skips damaged files and refuses ids that are paths', () => {
    const store = new SceneStore(dir);
    writeFileSync(join(dir, '0123456789abcdef.json'), '{not json');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(store.list()).toEqual([]);
    expect(() => store.get('../../secret')).toThrow(SceneInputError);
    expect(() => store.remove('..\\x')).toThrow(SceneInputError);
  });
});
