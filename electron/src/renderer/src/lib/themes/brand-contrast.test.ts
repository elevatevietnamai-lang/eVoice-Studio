// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Elevate default palette must stay readable (WCAG AA) in both appearances. The generated
 * mobile token file holds the resolved colours, so this checks what the apps and the desktop share.
 */
type Colors = Record<string, string>;
const tokens = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../../../mobile/contract/tokens.json'), 'utf8'),
) as { palettes: { id: string; colors: { light: Colors; dark: Colors } }[] };
const elevate = tokens.palettes.find((palette) => palette.id === 'default')!.colors;

function rgba(hex: string): [number, number, number, number] {
  const value = hex.replace('#', '');
  const n = (i: number) => parseInt(value.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), value.length >= 8 ? n(6) : 1];
}
function luminance([r, g, b]: number[]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(foreground: string, background: string): number {
  const bg = rgba(background);
  const fg = rgba(foreground);
  const over = fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
  const [a, b] = [luminance(over), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['text', 'canvas'],
  ['textMuted', 'canvas'],
  ['mutedForeground', 'canvas'],
  ['text', 'surface'],
  ['textMuted', 'surface'],
  ['accentForeground', 'accent'],
  ['secondaryForeground', 'secondary'],
  ['sidebarForeground', 'sidebar'],
  ['sidebarMutedForeground', 'sidebar'],
];

describe.each(['light', 'dark'] as const)('Elevate default palette (%s)', (appearance) => {
  const colors = elevate[appearance];
  it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (foreground, background) => {
    expect(contrast(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps the focus colour visible against the canvas (3:1)', () => {
    expect(contrast(colors.focus, colors.canvas)).toBeGreaterThanOrEqual(3);
  });
  it('is monochrome: the accent is the brand text colour, not a hue', () => {
    expect(colors.accent).toBe(colors.text);
  });
});
