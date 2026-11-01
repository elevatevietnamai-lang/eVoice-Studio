import { describe, expect, it } from 'vitest';

/**
 * The CSS side of no-decorative-effects.test.ts. Feature stylesheets follow DESIGN.md: the Elevate radii
 * (control, card, surface), no glow or soft drop shadows on in-flow surfaces, no backdrop blur, no lift or
 * scale on hover, and no gradients on surfaces. `styles/` holds the theme and the opt-in glass
 * layer, which globals.test.ts covers.
 */
// vitest stubs `.css` imports (`css: false`, even with ?raw), so read the files through Node.
const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readdirSync(path: string, options: { recursive: true }): string[];
        readFileSync(path: string, encoding: 'utf8'): string;
      };
    };
  }
).process.getBuiltinModule('node:fs');
const ROOT = 'src/renderer/src/';
const sheets = Object.fromEntries(
  fs
    .readdirSync(ROOT, { recursive: true })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.css') && !file.startsWith('styles/'))
    .map((file) => [file, fs.readFileSync(ROOT + file, 'utf8')]),
) as Record<string, string>;

const name = (file: string) => file;

// Floating layers keep their elevation: the in-app browser dialog and the narrow-screen inspector sheet.
const FLOATING_SHADOWS = new Set(['features/browser/site-browser-page.css', 'features/workflows/workflows.css']);
// The Pro page's feature cards draw small illustrations (lines, rings, grids) with gradients.
const ILLUSTRATIONS = new Set(['features/pro/pro-page.css']);

function declarations(source: string, property: string): string[] {
  return [...source.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;{}]+)`, 'g'))].map(
    (match) => match[1].trim(),
  );
}

function pixels(value: string): number | null {
  const match = /^([\d.]+)(px|rem)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

describe('feature stylesheets stay on the design system', () => {
  it('scans the feature stylesheets', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(5);
  });

  it('uses the control, card or surface radius (small corners, circles and pills aside)', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sheets)) {
      for (const value of declarations(source, 'border-radius')) {
        for (const part of value.split(/\s+/)) {
          const px = pixels(part);
          if (px !== null && px > 5 && px < 99) hits.push(`${name(file)}: border-radius ${value}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('has no glow or soft drop shadow outside floating layers', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sheets)) {
      if (FLOATING_SHADOWS.has(name(file))) continue;
      for (const value of declarations(source, 'box-shadow')) {
        for (const layer of value.split(/,(?![^(]*\))/)) {
          // offset-x offset-y blur: a blur above 0 makes a glow or a soft shadow.
          const lengths = layer.replace(/color-mix\([^)]*\)|rgb\([^)]*\)|var\([^)]*\)/g, '').match(/-?[\d.]+(?:px|rem)?/g);
          if (lengths && lengths.length >= 3 && Number.parseFloat(lengths[2]) > 0)
            hits.push(`${name(file)}: box-shadow ${layer.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('has no backdrop blur and no gradients on surfaces', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sheets)) {
      if (declarations(source, 'backdrop-filter').some((value) => value !== 'none'))
        hits.push(`${name(file)}: backdrop-filter`);
      if (!ILLUSTRATIONS.has(name(file)) && /(?:linear|radial|conic)-gradient\(/.test(source))
        hits.push(`${name(file)}: gradient`);
    }
    expect(hits).toEqual([]);
  });

  it('never lifts or scales a surface on hover', () => {
    const hits: string[] = [];
    for (const [file, source] of Object.entries(sheets)) {
      for (const rule of source.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)) {
        // Illustrations inside a card may animate; the card itself may not move.
        if (rule[1].includes('-effect')) continue;
        if (/transform\s*:\s*[^;]*(?:translateY|scale)\(/.test(rule[2]))
          hits.push(`${name(file)}: ${rule[1].trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
