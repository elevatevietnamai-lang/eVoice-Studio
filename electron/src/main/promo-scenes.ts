import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  escapeHtml,
  fontDataUri,
  LOGO_ID,
  TEMPLATE_FONTS,
  type FontId,
  type TemplateLogo,
} from './promo-templates';
import { readZip, safeEntryName, writeZip, ZipError } from './promo-zip';

/**
 * Custom HTML scenes for the promo video: the user's (or an imported, or an
 * AI-written) HTML, CSS and JS, rendered by HyperFrames like the built-in
 * animated templates. Everything here treats a scene as untrusted input.
 *
 * - Every field is size-capped and checked (parseScene); a saved or imported
 *   scene is only ever data in a JSON file, never a path on disk.
 * - The page that runs a scene (sceneDocument) opens with a Content Security
 *   Policy that allows no network at all and no file access: images and fonts
 *   are inlined as data URIs. The CSP comes before any user text, so user
 *   markup can only add restrictions.
 * - The preview runs that page in a sandboxed frame on its own scheme
 *   (promo-scene-protocol.ts); the render runs it in Chrome Headless Shell with
 *   a refusing proxy (promo-network-guard.ts). The CSP is one layer of several.
 */

export const SCENE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const MAX_SCENE_CODE_BYTES = 256 * 1024;
export const MAX_SCENE_PARAMS = 12;
export const MAX_SCENE_ASSETS = 16;
export const MAX_SCENE_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_SCENE_TOTAL_BYTES = 8 * 1024 * 1024;
/** Largest file the import dialog reads. */
export const MAX_SCENE_FILE_BYTES = 12 * 1024 * 1024;
export const MIN_SCENE_SECONDS = 1;
/** A full-frame scene can fill a whole shot (MAX_SHOT_SECONDS). */
export const MAX_SCENE_SECONDS = 60;
export const MAX_SCENE_NAME = 60;
export const MAX_SCENE_TEXT = 200;
export const MAX_SAVED_SCENES = 200;
const MAX_LABEL = 40;
const MIN_SIDE = 64;
const MAX_SIDE = 3840;

export type SceneParamType = 'text' | 'color' | 'image';

export interface SceneParam {
  /** Used as `{{key}}` in HTML/CSS and `scene.params.key` in JS. */
  key: string;
  type: SceneParamType;
  label: string;
  /** Text; `#rrggbb`; or for an image a promo media id, `asset:<name>` or ''. */
  value: string;
}

export interface SceneAsset {
  /** Flat file name, referenced as `assets/<name>`. */
  name: string;
  /** Base64 of the file. */
  data: string;
}

export interface PromoScene {
  /** Id of the saved copy, or null for an unsaved scene. */
  id: string | null;
  name: string;
  html: string;
  css: string;
  js: string;
  params: SceneParam[];
  assets: SceneAsset[];
  duration: number;
}

export interface SceneSummary {
  id: string;
  name: string;
  duration: number;
  updatedAt: number;
}

export class SceneInputError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`invalid_scene:${field}`);
    this.field = field;
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;
const PARAM_KEY = /^[a-z][a-z0-9_]{0,31}$/;
export const SCENE_ID = /^[0-9a-f]{16}$/;
/** Built-in names a param must not shadow. */
const RESERVED_KEYS = new Set(['width', 'height', 'duration']);

export const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

function cleanText(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new SceneInputError(field);
  const clean = value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .normalize('NFC');
  if ((required && !clean) || [...clean].length > max) throw new SceneInputError(field);
  return clean;
}

function code(value: unknown, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || bytes(value) > MAX_SCENE_CODE_BYTES) {
    throw new SceneInputError(field);
  }
  return value.replace(/\0/g, '');
}

export function assetMime(name: string): string | null {
  return ASSET_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** A flat asset name (no folder) with an allowed extension, or null. */
export function safeAssetName(raw: string): string | null {
  const name = safeEntryName(raw);
  if (!name || name.includes('/') || !assetMime(name)) return null;
  return name;
}

function parseAssets(raw: unknown): SceneAsset[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SCENE_ASSETS) throw new SceneInputError('assets');
  const seen = new Set<string>();
  let total = 0;
  return raw.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? safeAssetName(entry.name) : null;
    if (!name || seen.has(name.toLowerCase())) throw new SceneInputError('assets');
    seen.add(name.toLowerCase());
    if (typeof entry.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data)) {
      throw new SceneInputError('assets');
    }
    const size = Math.floor((entry.data.length * 3) / 4);
    total += size;
    if (size > MAX_SCENE_ASSET_BYTES || total > MAX_SCENE_TOTAL_BYTES) {
      throw new SceneInputError('assets');
    }
    return { name, data: entry.data };
  });
}

function parseParams(raw: unknown, assets: SceneAsset[]): SceneParam[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SCENE_PARAMS) throw new SceneInputError('params');
  const keys = new Set<string>();
  const assetNames = new Set(assets.map((asset) => asset.name));
  return raw.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const key = entry.key;
    if (
      typeof key !== 'string' ||
      !PARAM_KEY.test(key) ||
      keys.has(key) ||
      RESERVED_KEYS.has(key)
    ) {
      throw new SceneInputError('params');
    }
    keys.add(key);
    const type = entry.type;
    if (type !== 'text' && type !== 'color' && type !== 'image') {
      throw new SceneInputError('params');
    }
    const label = cleanText(entry.label ?? key, 'params', MAX_LABEL) || key;
    let value: string;
    if (type === 'text') value = cleanText(entry.value ?? '', `param:${key}`, MAX_SCENE_TEXT);
    else if (type === 'color') {
      if (typeof entry.value !== 'string' || !COLOR.test(entry.value)) {
        throw new SceneInputError(`param:${key}`);
      }
      value = entry.value.toLowerCase();
    } else {
      value = typeof entry.value === 'string' ? entry.value : '';
      const asset = value.startsWith('asset:') ? value.slice(6) : null;
      if (value && !LOGO_ID.test(value) && !(asset && assetNames.has(asset))) {
        throw new SceneInputError(`param:${key}`);
      }
    }
    return { key, type, label, value };
  });
}

/** Validates an untrusted scene (from the renderer, a file or an AI). */
export function parseScene(raw: unknown): PromoScene {
  if (!raw || typeof raw !== 'object') throw new SceneInputError('scene');
  const input = raw as Record<string, unknown>;
  let id: string | null = null;
  if (input.id !== undefined && input.id !== null) {
    if (typeof input.id !== 'string' || !SCENE_ID.test(input.id)) throw new SceneInputError('id');
    id = input.id;
  }
  const duration = input.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < MIN_SCENE_SECONDS ||
    duration > MAX_SCENE_SECONDS
  ) {
    throw new SceneInputError('duration');
  }
  const assets = parseAssets(input.assets);
  return {
    id,
    name: cleanText(input.name, 'name', MAX_SCENE_NAME, true),
    html: code(input.html, 'html'),
    css: code(input.css, 'css'),
    js: code(input.js, 'js'),
    params: parseParams(input.params, assets),
    assets,
    duration: Math.round(duration * 100) / 100,
  };
}

export function parseSide(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value % 2) {
    throw new SceneInputError(field);
  }
  if (value < MIN_SIDE || value > MAX_SIDE) throw new SceneInputError(field);
  return value;
}

// ── Lint ────────────────────────────────────────────────────────────────────

export type SceneProblem =
  | { code: 'remote_url'; detail: string }
  | { code: 'css_import' }
  | { code: 'unknown_font'; detail: string }
  | { code: 'timer_animation' };

/** Namespace URIs of inline SVG/MathML: identifiers, never fetched. */
const NAMESPACE_ATTR = /\sxmlns(?::[a-z]+)?\s*=\s*(["'])http:\/\/www\.w3\.org\/[^"']*\1/gi;
const REMOTE = /\b(?:https?|wss?|ftp):\/\/[^\s"'()<>]+/i;
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

const familyName = (raw: string) =>
  raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();

/** Font families named in CSS (and inline style attributes). */
export function usedFontFamilies(source: string): string[] {
  const found = new Set<string>();
  const add = (list: string) => {
    for (const part of list.replace(/!important/gi, '').split(',')) {
      const name = familyName(part);
      if (name && !name.includes('{{')) found.add(name);
    }
  };
  for (const match of source.matchAll(/font-family\s*:\s*([^;}"<]+|"[^"]*"[^;}<]*)/gi)) {
    add(match[1]);
  }
  // `font:` shorthand: the family list follows the size (and line height).
  for (const match of source.matchAll(/(?:^|[;{\s"'])font\s*:\s*([^;}<]+)/gi)) {
    const value = match[1];
    const size = /\d(?:\.\d+)?(?:px|em|rem|%|pt|vw|vh|vmin|vmax|ch|ex)(?:\s*\/\s*[^\s,]+)?\s+/gi;
    let last = -1;
    for (const found of value.matchAll(size)) last = (found.index ?? 0) + found[0].length;
    if (last > 0) add(value.slice(last));
  }
  return [...found];
}

/** Families the scene declares itself with `@font-face`. */
function declaredFamilies(css: string): Set<string> {
  const declared = new Set<string>();
  for (const block of css.matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const family = /font-family\s*:\s*([^;]+)/i.exec(block[1]);
    if (family) declared.add(familyName(family[1]).toLowerCase());
  }
  return declared;
}

/** Bundled font for a family name, if any. */
function bundledFont(name: string): FontId | null {
  const lower = name.toLowerCase();
  for (const [id, font] of Object.entries(TEMPLATE_FONTS)) {
    if (font.family.toLowerCase() === lower) return id as FontId;
  }
  return null;
}

/**
 * What would fail or misbehave when the scene renders. Remote URLs and
 * `@import` are blocked at render time anyway; fonts that are neither bundled
 * nor declared would make the producer look them up online (and fail).
 */
export function lintScene(scene: PromoScene): SceneProblem[] {
  const problems: SceneProblem[] = [];
  const all = [scene.html.replace(NAMESPACE_ATTR, ''), scene.css, scene.js].join('\n');
  const remote = REMOTE.exec(all);
  if (remote) problems.push({ code: 'remote_url', detail: remote[0].slice(0, 80) });
  if (/@import\b/i.test(scene.css) || /@import\b/i.test(scene.html)) {
    problems.push({ code: 'css_import' });
  }
  const declared = declaredFamilies(scene.css);
  for (const family of usedFontFamilies(`${scene.css}\n${scene.html}`)) {
    const lower = family.toLowerCase();
    if (GENERIC_FAMILIES.has(lower) || declared.has(lower) || bundledFont(family)) continue;
    problems.push({ code: 'unknown_font', detail: family.slice(0, 60) });
  }
  if (/\b(?:requestAnimationFrame|setInterval|setTimeout)\s*\(/.test(scene.js)) {
    problems.push({ code: 'timer_animation' });
  }
  return problems;
}

/** Problems that stop a preview or render (the rest are warnings). */
export const blocking = (problems: SceneProblem[]) =>
  problems.filter((problem) => problem.code !== 'timer_animation');

// ── The page ────────────────────────────────────────────────────────────────

export interface SceneFrame {
  width: number;
  height: number;
}

export interface SceneContext extends SceneFrame {
  mode: 'preview' | 'render';
  /** Data URI of a bundled font. */
  fontUri: (id: FontId) => string;
  /** Data URIs of the promo media ids the image params point at. */
  images: Map<string, string>;
  /**
   * What shows where the scene paints nothing. A full-frame shot is an opaque
   * MP4, where the producer would fill those areas white; black matches the
   * transparent overlay look and a dark video. Unset: transparent.
   */
  backdrop?: string;
}

const dataUri = (mime: string, base64: string) => `data:${mime};base64,${base64}`;

/** JSON safe inside a `<script>` element. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);

function paramValue(param: SceneParam, scene: PromoScene, images: Map<string, string>): string {
  if (param.type !== 'image') return param.value;
  if (param.value.startsWith('asset:')) {
    const asset = scene.assets.find((item) => item.name === param.value.slice(6));
    return asset ? dataUri(assetMime(asset.name)!, asset.data) : '';
  }
  return images.get(param.value) ?? '';
}

/** Replaces `{{key}}` in HTML (text escaped) or CSS (colors and images only). */
function substitute(
  source: string,
  context: 'html' | 'css',
  values: Map<string, { type: SceneParamType | 'number'; value: string }>,
): string {
  return source.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (whole, key: string) => {
    const entry = values.get(key);
    if (!entry) return whole;
    if (entry.type === 'text') return context === 'html' ? escapeHtml(entry.value) : '';
    // Colours are #rrggbb, numbers are numbers, images are data URIs.
    return context === 'html' ? escapeHtml(entry.value) : entry.value;
  });
}

/** Points `assets/<name>` references at the inlined files. */
function inlineAssets(source: string, scene: PromoScene): string {
  if (!scene.assets.length) return source;
  const byName = new Map(scene.assets.map((asset) => [asset.name, asset]));
  return source.replace(/\bassets\/([A-Za-z0-9._-]+)/g, (whole, name: string) => {
    const asset = byName.get(name);
    return asset ? dataUri(assetMime(name)!, asset.data) : whole;
  });
}

/**
 * Drives `hf-seek` from the wall clock in the preview, the way the HyperFrames
 * runtime does per frame in a render, and tells the parent the page is alive.
 */
const PREVIEW_DRIVER = `(function(){var s=performance.now();function f(){try{dispatchEvent(new CustomEvent('hf-seek',{detail:{time:(performance.now()-s)/1000,waitUntil:function(){}}}))}catch(e){}requestAnimationFrame(f)}requestAnimationFrame(f);setInterval(function(){parent.postMessage({promoScene:'alive'},'*')},400);parent.postMessage({promoScene:'alive'},'*')})();`;

/** The complete page for a scene, ready for the preview frame or a render. */
export function sceneDocument(scene: PromoScene, context: SceneContext): string {
  const { width, height } = context;
  const duration = scene.duration;
  const values = new Map<string, { type: SceneParamType | 'number'; value: string }>([
    ['width', { type: 'number', value: String(width) }],
    ['height', { type: 'number', value: String(height) }],
    ['duration', { type: 'number', value: String(duration) }],
  ]);
  const params: Record<string, string> = {};
  for (const param of scene.params) {
    const value = paramValue(param, scene, context.images);
    values.set(param.key, { type: param.type, value });
    params[param.key] = value;
  }
  const css = inlineAssets(substitute(scene.css, 'css', values), scene).replace(
    /<\/style/gi,
    '<\\/style',
  );
  const html = inlineAssets(
    substitute(scene.html.replace(NAMESPACE_ATTR, ''), 'html', values),
    scene,
  );
  const js = inlineAssets(scene.js, scene).replace(/<\/script/gi, '<\\/script');
  const fonts = (Object.keys(TEMPLATE_FONTS) as FontId[])
    .filter((id) => new RegExp(TEMPLATE_FONTS[id].family, 'i').test(`${css}\n${html}\n${js}`))
    .map((id) => {
      const font = TEMPLATE_FONTS[id];
      return (
        `@font-face{font-family:"${font.family}";src:url("${context.fontUri(id)}") format("truetype");` +
        `font-weight:${font.weight};font-style:normal;font-display:block}`
      );
    })
    .join('\n');
  const api = `window.scene=Object.freeze({width:${width},height:${height},duration:${duration},params:Object.freeze(${scriptJson(params)}),onFrame:function(f){addEventListener('hf-seek',function(e){f(e.detail.time)})}});`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SCENE_CSP}">
<style>${fonts}
html,body{margin:0;padding:0;background:${context.backdrop && COLOR.test(context.backdrop) ? context.backdrop : 'transparent'};overflow:hidden}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden}
#scene{position:absolute;inset:0}</style>
<style>${css}</style>
</head><body>
<div id="stage" data-composition-id="promo-scene" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
<div id="scene" class="clip" data-start="0" data-duration="${duration}" data-track-index="0">
${html}
</div>
</div>
<script>${api}${context.mode === 'preview' ? PREVIEW_DRIVER : ''}</script>
<script>${js}</script>
</body></html>
`;
}

/** Promo media ids the scene's image params name (fetched by the caller). */
export const sceneMediaIds = (scene: PromoScene) =>
  [
    ...new Set(
      scene.params.filter((p) => p.type === 'image' && LOGO_ID.test(p.value)).map((p) => p.value),
    ),
  ] as string[];

export const logoDataUri = (logo: TemplateLogo) =>
  dataUri(ASSET_MIME[logo.extension] ?? 'image/png', Buffer.from(logo.bytes).toString('base64'));

/** Context helper: bundled fonts read from the backend assets folder. */
export const assetsFontUri = (assetsDir: string) => (id: FontId) => fontDataUri(assetsDir, id);

// ── Files: import and export ────────────────────────────────────────────────

const META_ID = 'promo-scene';

interface SceneMeta {
  name?: unknown;
  duration?: unknown;
  params?: unknown;
}

function decodeText(data: Uint8Array, field: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    throw new SceneInputError(field);
  }
}

/**
 * Splits an HTML document into the scene's parts. The result is untrusted
 * text that parseScene checks and the sandbox runs; this split only has to be
 * convenient, never safe.
 */
export function splitHtml(source: string): {
  html: string;
  css: string;
  js: string;
  meta: SceneMeta;
} {
  let meta: SceneMeta = {};
  const styles: string[] = [];
  const scripts: string[] = [];
  let rest = source.replace(/<!--[\s\S]*?-->/g, '');
  rest = rest.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (_whole, attrs: string, body) => {
      if (new RegExp(`id\\s*=\\s*["']?${META_ID}\\b`, 'i').test(attrs)) {
        try {
          meta = JSON.parse(body) as SceneMeta;
        } catch {
          // A broken metadata block leaves the defaults.
        }
      } else if (
        !/\bsrc\s*=/i.test(attrs) &&
        !/type\s*=\s*["']?application\/(?:ld\+)?json/i.test(attrs)
      ) {
        scripts.push(String(body).trim());
      }
      return '';
    },
  );
  rest = rest.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_whole, body: string) => {
    styles.push(body.trim());
    return '';
  });
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(rest);
  const html = (body ? body[1] : rest.replace(/<head\b[\s\S]*?<\/head\s*>/i, ''))
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<(?:meta|link|title|base)\b[^>]*>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .trim();
  return { html, css: styles.join('\n\n'), js: scripts.join('\n\n'), meta };
}

/** The exported single-file form; splitHtml reads it back. */
export function sceneToHtml(scene: PromoScene): string {
  const meta = { version: 1, name: scene.name, duration: scene.duration, params: scene.params };
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(scene.name)}</title>
<script type="application/json" id="${META_ID}">${scriptJson(meta)}</script>
<style>
${scene.css.replace(/<\/style/gi, '<\\/style')}
</style>
</head><body>
${scene.html}
<script>
${scene.js.replace(/<\/script/gi, '<\\/script')}
</script>
</body></html>
`;
}

function fromParts(
  parts: { html: string; css: string; js: string; meta: SceneMeta },
  assets: SceneAsset[],
  fallbackName: string,
): PromoScene {
  const meta = parts.meta;
  const duration = typeof meta.duration === 'number' ? meta.duration : 5;
  const name =
    typeof meta.name === 'string' && meta.name.trim() ? meta.name : fallbackName || 'Scene';
  return parseScene({
    id: null,
    name: [...name].slice(0, MAX_SCENE_NAME).join(''),
    html: parts.html,
    css: parts.css,
    js: parts.js,
    params: Array.isArray(meta.params) ? meta.params : [],
    assets,
    duration: Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, duration)),
  });
}

const ZIP_LIMITS = {
  maxEntries: MAX_SCENE_ASSETS + 6,
  maxEntryBytes: MAX_SCENE_ASSET_BYTES,
  maxTotalBytes: MAX_SCENE_TOTAL_BYTES + 4 * MAX_SCENE_CODE_BYTES,
};

/**
 * A scene from an imported `.html` or `.zip`. Throws SceneInputError (with
 * `zip:<code>` for archive problems). The zip holds `index.html` (a whole
 * page or just the body), optional `style.css`, `script.js`, `scene.json`
 * (name, duration, params) and `assets/<file>`; nothing else is read.
 */
export function importScene(fileName: string, data: Uint8Array): PromoScene {
  if (data.byteLength > MAX_SCENE_FILE_BYTES) throw new SceneInputError('file_too_large');
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/\p{Cc}/gu, '');
  if (/\.html?$/i.test(fileName)) {
    return fromParts(splitHtml(decodeText(data, 'html')), [], base);
  }
  if (!/\.zip$/i.test(fileName)) throw new SceneInputError('file_type');
  let entries: Map<string, Uint8Array>;
  try {
    entries = readZip(data, ZIP_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new SceneInputError(`zip:${error.code}`);
    throw error;
  }
  const index = entries.get('index.html');
  if (!index) throw new SceneInputError('zip:no_index');
  const parts = splitHtml(decodeText(index, 'html'));
  const style = entries.get('style.css');
  const script = entries.get('script.js');
  const sceneJson = entries.get('scene.json');
  if (style) parts.css = [parts.css, decodeText(style, 'css')].filter(Boolean).join('\n\n');
  if (script) parts.js = [parts.js, decodeText(script, 'js')].filter(Boolean).join('\n\n');
  if (sceneJson) {
    try {
      parts.meta = JSON.parse(decodeText(sceneJson, 'meta')) as SceneMeta;
    } catch {
      throw new SceneInputError('meta');
    }
  }
  const assets: SceneAsset[] = [];
  for (const [name, bytesOf] of entries) {
    if (!name.startsWith('assets/')) continue;
    const file = safeAssetName(name.slice('assets/'.length));
    if (!file) throw new SceneInputError('zip:asset_type');
    assets.push({ name: file, data: Buffer.from(bytesOf).toString('base64') });
  }
  return fromParts(parts, assets, base);
}

/** `.zip` when the scene carries files, else a single `.html`. */
export function exportScene(scene: PromoScene): { extension: 'zip' | 'html'; data: Uint8Array } {
  if (!scene.assets.length) {
    return { extension: 'html', data: new Uint8Array(Buffer.from(sceneToHtml(scene), 'utf8')) };
  }
  const files = new Map<string, Uint8Array>([
    ['index.html', new Uint8Array(Buffer.from(sceneToHtml(scene), 'utf8'))],
  ]);
  for (const asset of scene.assets) {
    files.set(`assets/${asset.name}`, new Uint8Array(Buffer.from(asset.data, 'base64')));
  }
  return { extension: 'zip', data: writeZip(files) };
}

/** A file name for the export, from the scene name. */
export function exportFileName(scene: PromoScene, extension: string): string {
  const stem =
    scene.name
      .normalize('NFKD')
      .replace(/[^\w -]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'scene';
  return `${stem}.${extension}`;
}

// ── Saved scenes ────────────────────────────────────────────────────────────

/**
 * Saved scenes, one JSON file each in a folder of the app's data. File names
 * are generated ids; a scene's own content never names a path.
 */
export class SceneStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SCENE_ID.test(id)) throw new SceneInputError('id');
    return join(this.dir, `${id}.json`);
  }

  list(): SceneSummary[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: SceneSummary[] = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!SCENE_ID.test(id) || name !== `${id}.json`) continue;
      try {
        const scene = this.get(id);
        if (!scene) continue;
        out.push({
          id,
          name: scene.name,
          duration: scene.duration,
          updatedAt: statSync(this.file(id)).mtimeMs,
        });
      } catch {
        // A damaged file is skipped, not fatal for the list.
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): PromoScene | null {
    const path = this.file(id);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return null;
    }
    return { ...parseScene(JSON.parse(text)), id };
  }

  /** Saves a checked scene; a new one gets an id. Returns the saved scene. */
  save(scene: PromoScene): PromoScene {
    mkdirSync(this.dir, { recursive: true });
    let id = scene.id;
    if (!id || !this.exists(id)) {
      if (this.count() >= MAX_SAVED_SCENES) throw new SceneInputError('too_many_scenes');
      id = id ?? randomBytes(8).toString('hex');
    }
    const saved = { ...scene, id };
    const target = this.file(id);
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify(saved));
    renameSync(temp, target);
    return saved;
  }

  remove(id: string): void {
    rmSync(this.file(id), { force: true });
  }

  private exists(id: string): boolean {
    try {
      return statSync(this.file(id)).isFile();
    } catch {
      return false;
    }
  }

  private count(): number {
    try {
      return readdirSync(this.dir).filter((name) => /^[0-9a-f]{16}\.json$/.test(name)).length;
    } catch {
      return 0;
    }
  }
}
