// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintScene, parseScene, sceneDocument, usedFontFamilies } from './promo-scenes';
import { TEMPLATE_FONTS } from './promo-templates';

// The built-ins live in the renderer, outside this project's tsconfig, so they
// are loaded at run time (like blank-window-guard.test.ts reads the catalogs).
const renderer = join(process.cwd(), 'src/renderer/src');
type T = (key: string, values?: Record<string, unknown>) => string;
const { BUILTIN_SCENES, builtinScene } = (await import(
  /* @vite-ignore */ join(renderer, 'features/promo/scene-builtins.ts')
)) as {
  BUILTIN_SCENES: readonly string[];
  builtinScene: (id: string, t: T, options?: { logoId?: string | null }) => unknown;
};
const en = JSON.parse(readFileSync(join(renderer, 'i18n/locales/en.json'), 'utf8')) as {
  promo: Record<string, string>;
};

/** English catalog lookups, so a missing key shows up as the raw key. */
const t: T = (key, values) => {
  const text = en.promo[key.replace(/^promo\./, '')] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
};

/** The bundled library each built-in shows off (the rest are CSS only). */
const LIBRARY: Record<string, string> = {
  stagger_title: 'anime',
  sticker: 'lottie',
  logo_spring: 'motion',
  card_3d: 'three',
};

describe('built-in scenes', () => {
  it.each(BUILTIN_SCENES)('%s passes the checks main applies to any scene', (id) => {
    const scene = parseScene(builtinScene(id, t, { logoId: '0123456789abcdef.png' }));
    // The 3D scene only carries the WebGL warning the editor shows.
    expect(lintScene(scene)).toEqual(
      id === 'card_3d' ? [{ code: 'needs_webgl', detail: 'three' }] : [],
    );
    expect(scene.name).not.toMatch(/^promo\./);
    for (const param of scene.params) {
      expect(param.label).not.toMatch(/^promo\./);
      if (param.type === 'text') expect(param.value).not.toMatch(/^promo\./);
    }
  });

  it.each(BUILTIN_SCENES)('%s uses only bundled fonts and every param it declares', (id) => {
    const scene = parseScene(builtinScene(id, t));
    const bundled = Object.values(TEMPLATE_FONTS).map((font) => font.family);
    for (const family of usedFontFamilies(scene.css)) {
      expect([...bundled, 'sans-serif', 'serif']).toContain(family);
    }
    const page = sceneDocument(scene, {
      width: 1080,
      height: 1920,
      mode: 'render',
      fontUri: () => 'data:font/ttf;base64,AA==',
      images: new Map(),
    });
    // Every {{key}} was replaced: none of the scene's own keys is left over.
    expect(page).not.toMatch(/\{\{\s*[a-z]/);
  });

  it.each(BUILTIN_SCENES)('%s has unique keys and moves only on the scene clock', (id) => {
    const scene = parseScene(builtinScene(id, t));
    const keys = scene.params.map((param) => param.key);
    expect(new Set(keys).size).toBe(keys.length);
    // CSS animations, the bundled libraries' adapters and scene.onFrame are
    // all sought frame by frame; nothing runs on its own timer or randomness.
    expect(scene.js).not.toMatch(
      /requestAnimationFrame|setTimeout|setInterval|Math\.random|Date\.now|performance\.now/,
    );
    const library = /from "evoice:(\w+)"/.exec(scene.js)?.[1] ?? null;
    expect(library).toBe(LIBRARY[id] ?? null);
  });

  it.each(['lower_third', 'countdown', 'price', 'ticker', 'cta'])(
    '%s overlay fades out over its last .4 s',
    (id) => {
      const scene = parseScene(builtinScene(id, t));
      expect(scene.css).toContain('leave .4s calc({{duration}}s - .4s) ease-in forwards');
      expect(scene.html).toMatch(/class="[^"]*\bout\b|class="(price|ticker)"/);
    },
  );

  it('counts down over the whole scene, one digit per fifth', () => {
    const scene = parseScene(builtinScene('countdown', t));
    expect(scene.html.match(/<span>\d<\/span>/g)).toHaveLength(5);
    expect(scene.css).toContain('count {{duration}}s steps(5, jump-none)');
    expect(scene.css).toContain('translateY(-80%)');
  });
});
