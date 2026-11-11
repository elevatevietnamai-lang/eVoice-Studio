import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Animated promo templates rendered by HyperFrames into transparent overlays.
 *
 * Rules every template follows (docs/electron-promo.md):
 * - no `http://` or `https://` anywhere in the source: Chrome loads the page
 *   outside the Node network guard, so the template itself must be local
 *   (inline SVG therefore leaves out the optional `xmlns`);
 * - every font family has a local `@font-face`, otherwise the producer looks
 *   the family up on Google Fonts;
 * - CSS animation only (no GSAP: its licence does not fit AGPL);
 * - nothing paints the body, so the WebM keeps its alpha channel;
 * - user text is NFC-normalized and HTML-escaped, colours are strict
 *   `#rrggbb`, and a logo is a backend media id, so input can never add markup,
 *   a `url(...)` or a path.
 */

export const PROMO_TEMPLATES = [
  'glow_title',
  'handwriting',
  'search_bar',
  'contact_card',
  'logo_reveal',
] as const;
export type PromoTemplateId = (typeof PROMO_TEMPLATES)[number];

/**
 * Bundled fonts, relative to `backend/assets`. Weight ranges come from each
 * font's `fvar` table; Chrome synthesizes weights outside them.
 */
export const TEMPLATE_FONTS = {
  inter: { family: 'Inter', source: 'fonts/InterVariable.ttf', weight: '100 900' },
  oswald: { family: 'Oswald', source: 'promo-fonts/Oswald-Variable.ttf', weight: '200 700' },
  dancing: {
    family: 'Dancing Script',
    source: 'promo-fonts/DancingScript-Variable.ttf',
    weight: '400 700',
  },
} as const;
type FontId = keyof typeof TEMPLATE_FONTS;

export const TEMPLATE_SPECS: Record<
  PromoTemplateId,
  { fonts: readonly FontId[]; lines: boolean; logo: boolean }
> = {
  glow_title: { fonts: ['inter'], lines: false, logo: false },
  handwriting: { fonts: ['dancing', 'inter'], lines: false, logo: false },
  search_bar: { fonts: ['inter'], lines: false, logo: false },
  contact_card: { fonts: ['oswald', 'inter'], lines: true, logo: false },
  logo_reveal: { fonts: ['oswald', 'inter'], lines: false, logo: true },
};

export interface PromoTemplateInput {
  template: PromoTemplateId;
  title: string;
  subtitle: string;
  /** Contact card rows (phone, address, website…). */
  lines: string[];
  /** Backend promo media id of the logo, for templates that show one. */
  logoId: string | null;
  color: string;
  /** Accent: the glow, underline, icon or card bar. */
  glow: string;
  duration: number;
  width: number;
  height: number;
}

export const MAX_TEMPLATE_TEXT = 80;
export const MAX_TEMPLATE_LINES = 3;
export const MIN_TEMPLATE_SECONDS = 1;
export const MAX_TEMPLATE_SECONDS = 30;
const MAX_SIDE = 3840;
const MIN_SIDE = 64;
/** Same shape as the ids `POST /promo/media` hands out, images only. */
export const LOGO_ID = /^[0-9a-f]{16}\.(png|jpe?g|webp)$/;

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
  const clean = value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .normalize('NFC');
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
  const template = input.template as PromoTemplateId;
  const spec = TEMPLATE_SPECS[template];
  const duration = input.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < MIN_TEMPLATE_SECONDS ||
    duration > MAX_TEMPLATE_SECONDS
  ) {
    throw new TemplateInputError('duration');
  }
  let lines: string[] = [];
  if (spec.lines && input.lines !== undefined) {
    if (!Array.isArray(input.lines) || input.lines.length > MAX_TEMPLATE_LINES) {
      throw new TemplateInputError('lines');
    }
    lines = input.lines.map((line) => text(line, 'lines', false)).filter(Boolean);
  }
  let logoId: string | null = null;
  if (spec.logo) {
    if (typeof input.logoId !== 'string' || !LOGO_ID.test(input.logoId)) {
      throw new TemplateInputError('logo');
    }
    logoId = input.logoId;
  }
  return {
    template,
    // A logo reveal may carry only the logo.
    title: text(input.title, 'title', !spec.logo),
    subtitle: text(input.subtitle ?? '', 'subtitle', false),
    lines,
    logoId,
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

/** User-perceived characters, so a typed Vietnamese letter keeps its marks. */
export function graphemes(value: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    (part) => part.segment,
  );
}

const px = (value: number) => `${Math.round(value)}px`;
const s = (value: number) => `${Math.max(0, Math.round(value * 1000) / 1000)}s`;
const family = (id: FontId) => `"${TEMPLATE_FONTS[id].family}"`;

interface Frame {
  input: PromoTemplateInput;
  base: number;
  exit: number;
}

/**
 * One full-length clip holding a centred column; templates fill it. Each
 * template's own CSS goes in `css`, its markup in `body`.
 */
function page(frame: Frame, css: string, body: string, fontsCss: string): string {
  const { width, height, duration } = frame.input;
  return `<!doctype html>
<html><head><meta charset="utf-8">
${fontsCss}
<style>
html,body{margin:0;padding:0;background:transparent}
#stage{position:relative;width:${px(width)};height:${px(height)};overflow:hidden}
#column{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:${px(frame.base * 0.03)};padding:0 6%;box-sizing:border-box;text-align:center;
  overflow-wrap:anywhere;animation:out 0.5s ${s(frame.exit)} ease-in forwards}
@keyframes out{to{opacity:0}}
${css}
</style></head>
<body>
<div id="stage" data-composition-id="promo-overlay" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
<div id="column" class="clip" data-start="0" data-duration="${duration}" data-track-index="0">
${body}
</div>
</div>
</body></html>
`;
}

function glowTitle({ input, base }: Frame) {
  const size = base * 0.13;
  const sub = base * 0.055;
  const css = `
#title{font:900 ${px(size)}/1.05 ${family('inter')};letter-spacing:0.02em;color:${input.color};
  animation:rise 0.9s cubic-bezier(.2,.8,.2,1) both,pulse 1.6s 0.9s ease-in-out infinite alternate}
#sub{font:500 ${px(sub)}/1.2 ${family('inter')};color:${input.color};text-shadow:0 0 ${px(sub * 0.4)} ${input.glow};
  animation:fade 0.8s 0.5s ease-out both}
@keyframes rise{from{transform:translateY(${px(size)}) scale(.7);opacity:0;filter:blur(${px(size * 0.15)})}
  to{transform:none;opacity:1;filter:none}}
@keyframes pulse{from{text-shadow:0 0 ${px(size * 0.15)} ${input.glow},0 0 ${px(size * 0.4)} ${input.glow}}
  to{text-shadow:0 0 ${px(size * 0.3)} ${input.glow},0 0 ${px(size * 0.8)} ${input.glow}}}
@keyframes fade{from{opacity:0;transform:translateY(${px(sub)})}to{opacity:.92;transform:none}}`;
  const body =
    `<div id="title">${escapeHtml(input.title)}</div>` +
    (input.subtitle ? `\n<div id="sub">${escapeHtml(input.subtitle)}</div>` : '');
  return { css, body };
}

function handwriting({ input, base, exit }: Frame) {
  const size = base * 0.15;
  const sub = base * 0.05;
  const write = Math.min(2.2, Math.max(0.6, exit - 0.6));
  const css = `
#write{position:relative;display:inline-block;padding:0 ${px(size * 0.15)}}
#title{font:700 ${px(size)}/1.25 ${family('dancing')};color:${input.color};
  text-shadow:0 ${px(size * 0.04)} ${px(size * 0.12)} rgba(0,0,0,.35);
  animation:reveal ${s(write)} cubic-bezier(.45,.05,.55,.95) both}
#line{display:block;width:100%;height:${px(size * 0.22)};overflow:visible}
#line path{fill:none;stroke:${input.glow};stroke-width:${px(size * 0.05)};stroke-linecap:round;
  stroke-dasharray:1000;stroke-dashoffset:1000;animation:draw 0.7s ${s(write * 0.85)} ease-out forwards}
#sub{font:500 ${px(sub)}/1.25 ${family('inter')};color:${input.color};letter-spacing:0.04em;
  animation:fade 0.7s ${s(write * 0.9)} ease-out both}
@keyframes reveal{from{clip-path:inset(-20% 100% -20% 0);transform:translateX(${px(-size * 0.1)})}
  to{clip-path:inset(-20% -5% -20% 0);transform:none}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes fade{from{opacity:0;transform:translateY(${px(sub * 0.6)})}to{opacity:.95;transform:none}}`;
  const body =
    `<div id="write"><div id="title">${escapeHtml(input.title)}</div>` +
    '<svg id="line" viewBox="0 0 1000 60" preserveAspectRatio="none"><path pathLength="1000" d="M20 40 C 260 10, 520 55, 980 22"/></svg></div>' +
    (input.subtitle ? `\n<div id="sub">${escapeHtml(input.subtitle)}</div>` : '');
  return { css, body };
}

function searchBar({ input, base, exit }: Frame) {
  const size = base * 0.055;
  const chars = graphemes(input.title);
  const typingStart = 0.7;
  // Typing always ends before the fade-out, however long the text.
  const step = Math.min(0.14, Math.max(0, exit - 0.4 - typingStart) / Math.max(1, chars.length));
  const typed = chars
    .map(
      (char, index) =>
        `<span class="k" style="animation-delay:${s(typingStart + index * step)}">${escapeHtml(char)}</span>`,
    )
    .join('');
  const css = `
#bar{display:flex;align-items:center;gap:${px(size * 0.6)};width:78%;padding:${px(size * 0.7)} ${px(size * 0.9)};
  border-radius:${px(size * 2)};background:#ffffff;box-shadow:0 ${px(size * 0.3)} ${px(size * 1.2)} rgba(0,0,0,.35);
  animation:pop 0.5s cubic-bezier(.2,1.4,.4,1) both}
#icon{flex:none;width:${px(size * 1.1)};height:${px(size * 1.1)}}
#icon circle,#icon line{fill:none;stroke:${input.glow};stroke-width:3;stroke-linecap:round}
#query{flex:1;min-width:0;text-align:left;white-space:pre;overflow:hidden;
  font:500 ${px(size)}/1.3 ${family('inter')};color:${input.color}}
.k{opacity:0;animation:key 0.01s steps(1) forwards}
#caret{display:inline-block;width:${px(size * 0.08)};height:${px(size * 1.1)};margin-left:${px(size * 0.05)};
  vertical-align:middle;background:${input.glow};animation:blink 1s steps(1) infinite}
#sub{font:500 ${px(size * 0.85)}/1.3 ${family('inter')};color:#ffffff;
  text-shadow:0 ${px(size * 0.06)} ${px(size * 0.3)} rgba(0,0,0,.6);
  animation:fade 0.6s ${s(typingStart + chars.length * step + 0.2)} ease-out both}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes key{to{opacity:1}}
@keyframes blink{50%{opacity:0}}
@keyframes fade{from{opacity:0;transform:translateY(${px(size * 0.5)})}to{opacity:1;transform:none}}`;
  const body =
    '<div id="bar"><svg id="icon" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>' +
    `<div id="query">${typed}<span id="caret"></span></div></div>` +
    (input.subtitle ? `\n<div id="sub">${escapeHtml(input.subtitle)}</div>` : '');
  return { css, body };
}

function contactCard({ input, base }: Frame) {
  const size = base * 0.065;
  const line = base * 0.042;
  const rows = input.lines
    .map(
      (row, index) =>
        `<div class="row" style="animation-delay:${s(0.75 + index * 0.18)}"><span class="dot"></span>${escapeHtml(row)}</div>`,
    )
    .join('');
  const css = `
#card{position:relative;width:76%;box-sizing:border-box;padding:${px(size * 0.8)} ${px(size * 0.9)} ${px(size * 0.8)} ${px(size * 1.1)};
  border-radius:${px(size * 0.35)};background:rgba(10,10,12,.62);box-shadow:0 ${px(size * 0.2)} ${px(size)} rgba(0,0,0,.35);
  text-align:left;animation:slide 0.7s cubic-bezier(.2,.9,.2,1) both}
#card::before{content:"";position:absolute;left:0;top:${px(size * 0.5)};bottom:${px(size * 0.5)};width:${px(size * 0.12)};
  border-radius:${px(size * 0.06)};background:${input.glow};transform-origin:top;animation:bar 0.5s 0.35s ease-out both}
#title{font:600 ${px(size)}/1.1 ${family('oswald')};text-transform:uppercase;letter-spacing:0.04em;color:${input.color}}
#sub{margin-top:${px(size * 0.2)};font:400 ${px(line)}/1.3 ${family('inter')};color:${input.color};opacity:.8}
.row{display:flex;align-items:center;gap:${px(line * 0.5)};margin-top:${px(line * 0.45)};
  font:500 ${px(line)}/1.3 ${family('inter')};color:${input.color};animation:row 0.45s ease-out both}
.dot{flex:none;width:${px(line * 0.32)};height:${px(line * 0.32)};border-radius:50%;background:${input.glow}}
@keyframes slide{from{transform:translateY(${px(size * 1.5)});opacity:0}to{transform:none;opacity:1}}
@keyframes bar{from{transform:scaleY(0)}to{transform:none}}
@keyframes row{from{opacity:0;transform:translateX(${px(-line)})}to{opacity:1;transform:none}}`;
  const body =
    `<div id="card"><div id="title">${escapeHtml(input.title)}</div>` +
    (input.subtitle ? `<div id="sub">${escapeHtml(input.subtitle)}</div>` : '') +
    `${rows}</div>`;
  return { css, body };
}

function logoReveal({ input, base, exit }: Frame, logoSrc: string) {
  const size = base * 0.09;
  const sub = base * 0.042;
  const css = `
#logo{display:block;max-width:${px(input.width * 0.5)};max-height:${px(input.height * 0.28)};object-fit:contain;
  filter:drop-shadow(0 0 ${px(size * 0.35)} ${input.glow});animation:logo 1.1s cubic-bezier(.2,.9,.2,1) both}
#title{font:600 ${px(size)}/1.1 ${family('oswald')};text-transform:uppercase;color:${input.color};
  animation:spread ${s(Math.min(1.6, Math.max(0.6, exit - 0.6)))} 0.5s cubic-bezier(.2,.8,.2,1) both}
#sub{font:400 ${px(sub)}/1.3 ${family('inter')};color:${input.color};opacity:.85;letter-spacing:0.06em;
  animation:fade 0.7s 1s ease-out both}
@keyframes logo{from{transform:scale(.6);opacity:0;filter:blur(${px(size * 0.2)}) drop-shadow(0 0 0 ${input.glow})}
  to{transform:none;opacity:1}}
@keyframes spread{from{letter-spacing:-0.05em;opacity:0}to{letter-spacing:0.18em;opacity:1}}
@keyframes fade{from{opacity:0}to{opacity:.85}}`;
  const body =
    `<img id="logo" src="${escapeHtml(logoSrc)}" alt="">` +
    (input.title ? `\n<div id="title">${escapeHtml(input.title)}</div>` : '') +
    (input.subtitle ? `\n<div id="sub">${escapeHtml(input.subtitle)}</div>` : '');
  return { css, body };
}

export interface TemplateAssets {
  /** `<link>` or inline `<style>` with the template's `@font-face` rules. */
  fontsCss: string;
  /** Where the page loads the logo from: a project file or a data URI. */
  logoSrc?: string;
}

export function templateHtml(input: PromoTemplateInput, assets: TemplateAssets): string {
  const frame: Frame = {
    input,
    base: Math.min(input.width, input.height),
    exit: Math.max(0, input.duration - 0.5),
  };
  const part = (() => {
    switch (input.template) {
      case 'glow_title':
        return glowTitle(frame);
      case 'handwriting':
        return handwriting(frame);
      case 'search_bar':
        return searchBar(frame);
      case 'contact_card':
        return contactCard(frame);
      case 'logo_reveal':
        return logoReveal(frame, assets.logoSrc ?? '');
    }
  })();
  return page(frame, part.css, part.body, assets.fontsCss);
}

/** `@font-face` rules for a template, each `src` produced by `url`. */
export function fontFaces(template: PromoTemplateId, url: (id: FontId) => string): string {
  return TEMPLATE_SPECS[template].fonts
    .map((id) => {
      const font = TEMPLATE_FONTS[id];
      return (
        `@font-face{font-family:"${font.family}";src:url("${url(id)}") format("truetype");` +
        `font-weight:${font.weight};font-style:normal;font-display:block}`
      );
    })
    .join('\n');
}

const fileName = (id: FontId) => TEMPLATE_FONTS[id].source.split('/').pop()!;

export interface TemplateLogo {
  bytes: Uint8Array;
  extension: string;
}

/**
 * Writes index.html, fonts.css, the template's fonts and its logo into an
 * empty project directory. `assetsDir` is the backend's `assets` folder.
 */
export function writeTemplateProject(
  dir: string,
  input: PromoTemplateInput,
  assetsDir: string,
  logo?: TemplateLogo,
): void {
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  for (const id of TEMPLATE_SPECS[input.template].fonts) {
    copyFileSync(join(assetsDir, TEMPLATE_FONTS[id].source), join(dir, 'fonts', fileName(id)));
  }
  writeFileSync(
    join(dir, 'fonts.css'),
    `${fontFaces(input.template, (id) => `fonts/${fileName(id)}`)}\n`,
  );
  let logoSrc: string | undefined;
  if (TEMPLATE_SPECS[input.template].logo) {
    if (!logo) throw new TemplateInputError('logo');
    logoSrc = `logo.${logo.extension}`;
    writeFileSync(join(dir, logoSrc), logo.bytes);
  }
  writeFileSync(
    join(dir, 'index.html'),
    templateHtml(input, { fontsCss: '<link rel="stylesheet" href="fonts.css">', logoSrc }),
  );
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * One self-contained page for the live preview: fonts and logo as data URIs,
 * so it works inside a sandboxed `srcdoc` frame with no origin.
 */
export function previewHtml(
  input: PromoTemplateInput,
  assetsDir: string,
  logo?: TemplateLogo,
): string {
  const faces = fontFaces(
    input.template,
    (id) =>
      `data:font/ttf;base64,${readFileSync(join(assetsDir, TEMPLATE_FONTS[id].source)).toString('base64')}`,
  );
  const logoSrc = logo
    ? `data:${MIME[logo.extension] ?? 'image/png'};base64,${Buffer.from(logo.bytes).toString('base64')}`
    : undefined;
  return templateHtml(input, { fontsCss: `<style>${faces}</style>`, logoSrc });
}
