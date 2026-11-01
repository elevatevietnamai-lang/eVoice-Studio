import { describe, expect, it } from 'vitest';
import tokensJson from '../../../../../../mobile/contract/tokens.json?raw';

/**
 * The Elevate default palette must stay readable (WCAG AA) in both appearances. The generated
 * mobile token file holds the resolved colours, so this checks what the apps and the desktop share.
 */
type Colors = Record<string, string>;
const tokens = JSON.parse(tokensJson) as {
  palettes: { id: string; colors: { light: Colors; dark: Colors } }[];
};
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

/**
 * Status colours are used as text (`text-destructive`, `text-warning`, update banners), so every
 * palette, not just the default, must keep them at 4.5:1 on the canvas and on the card surface.
 */
const STATUS_KEYS = [
  'error',
  'errorForeground',
  'warning',
  'warningForeground',
  'update',
  'updateForeground',
] as const;

describe.each(tokens.palettes.flatMap((palette) => (['light', 'dark'] as const).map((appearance) => [palette.id, appearance, palette.colors[appearance]] as const)))(
  'status colours in %s (%s)',
  (_id, _appearance, colors) => {
    it.each(STATUS_KEYS)('%s reaches 4.5:1 on canvas and surface', (key) => {
      expect(contrast(colors[key], colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[key], colors.surface)).toBeGreaterThanOrEqual(4.5);
    });
  },
);

/**
 * House rules (not WCAG): a hover must be visible, so the row or control surface has to differ from
 * the one it sits on by a minimum contrast, and the muted label on it must stay readable.
 * Control borders (inputs) reach 3:1 on the canvas (WCAG 1.4.11).
 */
const STATE_STEPS: [state: string, base: string, min: number][] = [
  ['sidebarRowHover', 'sidebar', 1.15],
  ['sidebarRowSelected', 'sidebar', 1.25],
  ['toolbarControlHover', 'toolbarControl', 1.15],
];

describe.each(
  tokens.palettes.flatMap((palette) =>
    (['light', 'dark'] as const).map(
      (appearance) => [palette.id, appearance, palette.colors[appearance]] as const,
    ),
  ),
)('interaction states in %s (%s)', (_id, _appearance, colors) => {
  it.each(STATE_STEPS)('%s differs from %s by %s:1', (state, base, min) => {
    expect(contrast(colors[state], colors[base])).toBeGreaterThanOrEqual(min);
  });
  it('keeps muted sidebar text readable on hover and selected rows', () => {
    expect(contrast(colors.sidebarMutedForeground, colors.sidebarRowHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.sidebarForeground, colors.sidebarRowSelected)).toBeGreaterThanOrEqual(4.5);
  });
  it('draws input borders at 3:1 on the canvas', () => {
    expect(contrast(colors.input, colors.canvas)).toBeGreaterThanOrEqual(3);
  });
});
