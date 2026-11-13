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

describe('built-in scenes', () => {
  it.each(BUILTIN_SCENES)('%s passes the checks main applies to any scene', (id) => {
    const scene = parseScene(builtinScene(id, t, { logoId: '0123456789abcdef.png' }));
    expect(lintScene(scene)).toEqual([]);
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

  it.each(BUILTIN_SCENES)('%s has unique keys and moves with CSS only', (id) => {
    const scene = parseScene(builtinScene(id, t));
    const keys = scene.params.map((param) => param.key);
    expect(new Set(keys).size).toBe(keys.length);
    // The render seeks CSS animations exactly, so nothing can stutter. The
    // starter only carries a commented-out example of scene.onFrame.
    if (id !== 'starter') expect(scene.js).toBe('');
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
