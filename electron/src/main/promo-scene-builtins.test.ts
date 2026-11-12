// @vitest-environment node
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../renderer/src/i18n/locales/en.json';
import { BUILTIN_SCENES, builtinScene } from '../renderer/src/features/promo/scene-builtins';
import { lintScene, parseScene, sceneDocument, usedFontFamilies } from './promo-scenes';
import { TEMPLATE_FONTS } from './promo-templates';

/** English catalog lookups, so a missing key shows up as the raw key. */
const t = ((key: string, values?: Record<string, unknown>) => {
  const text = (en.promo as Record<string, string>)[key.replace(/^promo\./, '')] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
}) as unknown as TFunction;

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
});
