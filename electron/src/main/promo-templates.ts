import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Animated promo templates rendered by HyperFrames into transparent overlays.
 *
 * Rules every template follows (docs/electron-promo.md):
 * - no `http://` or `https://` anywhere in the source: Chrome loads the page
 *   outside the Node network guard, so the template itself must be local;
 * - every font family has a local `@font-face` in `fonts.css`, otherwise the
 *   producer looks the family up on Google Fonts;
 * - CSS animation or Web Animations only (no GSAP: its licence does not fit
 *   AGPL);
 * - nothing paints the body, so the WebM keeps its alpha channel;
 * - user text is HTML-escaped and colours are strict `#rrggbb`, so input can
 *   never add markup or a `url(...)`.
 */

export const PROMO_TEMPLATES = ['glow_title'] as const;
export type PromoTemplateId = (typeof PROMO_TEMPLATES)[number];

export interface PromoTemplateInput {
  template: PromoTemplateId;
  title: string;
  subtitle: string;
  color: string;
  glow: string;
  duration: number;
  width: number;
  height: number;
}

export const MAX_TEMPLATE_TEXT = 80;
export const MIN_TEMPLATE_SECONDS = 1;
export const MAX_TEMPLATE_SECONDS = 30;
const MAX_SIDE = 3840;
const MIN_SIDE = 64;

/** Fonts copied from the backend's bundled fonts into every project. */
export const TEMPLATE_FONTS = [{ family: 'Inter', file: 'InterVariable.ttf' }] as const;

export const FONTS_CSS = TEMPLATE_FONTS.map(
  ({ family, file }) =>
    `@font-face{font-family:"${family}";src:url("fonts/${file}") format("truetype");` +
    'font-weight:100 900;font-style:normal;font-display:block}',
).join('\n');

const COLOR = /^#[0-9a-f]{6}$/i;

export class TemplateInputError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`invalid_template_input:${field}`);
    this.field = field;
  }
}

function text(value: unknown, field: string, required: boolean): string {
  if (typeof value !== 'string') throw new TemplateInputError(field);
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if ((required && !clean) || [...clean].length > MAX_TEMPLATE_TEXT) {
    throw new TemplateInputError(field);
  }
  return clean;
}

function color(value: unknown, field: string): string {
  if (typeof value !== 'string' || !COLOR.test(value)) throw new TemplateInputError(field);
  return value.toLowerCase();
}

function side(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TemplateInputError(field);
  if (value < MIN_SIDE || value > MAX_SIDE || value % 2) throw new TemplateInputError(field);
  return value;
}

/** Validates untrusted input from the renderer. Throws TemplateInputError. */
export function parseTemplateInput(raw: unknown): PromoTemplateInput {
  if (!raw || typeof raw !== 'object') throw new TemplateInputError('input');
  const input = raw as Record<string, unknown>;
  if (!PROMO_TEMPLATES.includes(input.template as PromoTemplateId)) {
    throw new TemplateInputError('template');
  }
  const duration = input.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < MIN_TEMPLATE_SECONDS ||
    duration > MAX_TEMPLATE_SECONDS
  ) {
    throw new TemplateInputError('duration');
  }
  return {
    template: input.template as PromoTemplateId,
    title: text(input.title, 'title', true),
    subtitle: text(input.subtitle ?? '', 'subtitle', false),
    color: color(input.color, 'color'),
    glow: color(input.glow, 'glow'),
    duration: Math.round(duration * 100) / 100,
    width: side(input.width, 'width'),
    height: side(input.height, 'height'),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const px = (value: number) => `${Math.round(value)}px`;

function glowTitle(input: PromoTemplateInput): string {
  const { width, height, duration } = input;
  const base = Math.min(width, height);
  const titleSize = base * 0.13;
  const subSize = base * 0.055;
  const exit = Math.max(0, duration - 0.5);
  const clip = (track: number) =>
    `class="clip" data-start="0" data-duration="${duration}" data-track-index="${track}"`;
  const subtitle = input.subtitle
    ? `<div ${clip(1)} id="sub">${escapeHtml(input.subtitle)}</div>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="fonts.css">
<style>
html,body{margin:0;padding:0;background:transparent}
#stage{position:relative;width:${px(width)};height:${px(height)};overflow:hidden;font-family:"Inter"}
#title,#sub{position:absolute;left:5%;width:90%;text-align:center;font-family:"Inter";overflow-wrap:anywhere}
#title{top:${px(height * 0.5 - titleSize * 1.1)};font-size:${px(titleSize)};line-height:1.05;font-weight:900;
  letter-spacing:0.02em;color:${input.color};
  animation:rise 0.9s cubic-bezier(.2,.8,.2,1) both,pulse 1.6s 0.9s ease-in-out infinite alternate,out 0.5s ${exit}s ease-in forwards}
#sub{top:${px(height * 0.5 + titleSize * 0.35)};font-size:${px(subSize)};line-height:1.2;font-weight:500;
  color:${input.color};opacity:0.92;text-shadow:0 0 ${px(subSize * 0.4)} ${input.glow};
  animation:fade 0.8s 0.5s ease-out both,out 0.5s ${exit}s ease-in forwards}
@keyframes rise{from{transform:translateY(${px(titleSize)}) scale(.7);opacity:0;filter:blur(${px(titleSize * 0.15)})}
  to{transform:none;opacity:1;filter:none}}
@keyframes pulse{from{text-shadow:0 0 ${px(titleSize * 0.15)} ${input.glow},0 0 ${px(titleSize * 0.4)} ${input.glow}}
  to{text-shadow:0 0 ${px(titleSize * 0.3)} ${input.glow},0 0 ${px(titleSize * 0.8)} ${input.glow}}}
@keyframes fade{from{opacity:0;transform:translateY(${px(subSize)})}to{opacity:.92;transform:none}}
@keyframes out{to{opacity:0}}
</style></head>
<body>
<div id="stage" data-composition-id="promo-overlay" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
<div ${clip(0)} id="title">${escapeHtml(input.title)}</div>
${subtitle}
</div>
</body></html>
`;
}

export function templateHtml(input: PromoTemplateInput): string {
  switch (input.template) {
    case 'glow_title':
      return glowTitle(input);
  }
}

/** Writes index.html, fonts.css and the fonts into an empty project directory. */
export function writeTemplateProject(dir: string, input: PromoTemplateInput, fontsDir: string): void {
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  for (const { file } of TEMPLATE_FONTS) copyFileSync(join(fontsDir, file), join(dir, 'fonts', file));
  writeFileSync(join(dir, 'fonts.css'), `${FONTS_CSS}\n`);
  writeFileSync(join(dir, 'index.html'), templateHtml(input));
}
