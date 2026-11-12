import type { PromoScene, PromoSceneParam, PromoSceneProblem } from '../../../../preload/index.d';
import { MAX_SHOT_SECONDS, shotFor, type PromoMedia, type PromoShot } from './promo-model';

/**
 * Custom HTML scenes on the renderer side. main/promo-scenes.ts checks every
 * scene again (sizes, params, assets); the limits here only keep the editor
 * from offering what main would refuse.
 */

export type { PromoScene, PromoSceneParam, PromoSceneProblem };

/** Mirrors main/promo-scenes.ts. */
export const SCENE_LIMITS = {
  codeBytes: 256 * 1024,
  params: 12,
  assets: 16,
  assetBytes: 4 * 1024 * 1024,
  totalAssetBytes: 8 * 1024 * 1024,
  minSeconds: 1,
  maxSeconds: 60,
  name: 60,
  text: 200,
} as const;

export const ASSET_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'woff2',
  'woff',
  'ttf',
  'otf',
];
const PARAM_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const RESERVED = new Set(['width', 'height', 'duration']);

export const STARTER_HTML = `<div class="card">
  <h1 class="title">{{title}}</h1>
  <p class="line">{{subtitle}}</p>
</div>`;

export const STARTER_CSS = `.card {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2vh; text-align: center; padding: 0 8%;
}
.title {
  margin: 0; font: 900 11vmin/1 "Inter"; color: {{color}};
  animation: rise 0.9s cubic-bezier(.2,.8,.2,1) both;
}
.line {
  margin: 0; font: 500 4.5vmin/1.3 "Inter"; color: {{color}}; opacity: .9;
  animation: rise 0.9s 0.3s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes rise { from { opacity: 0; transform: translateY(6vh); } to { opacity: 1; transform: none; } }`;

export const STARTER_JS = `// Optional. scene.params holds the values above; scene.onFrame(t => ...)
// runs on every rendered frame with the time in seconds.`;

/** Words the starter scene shows, already translated. */
export interface StarterText {
  name: string;
  title: string;
  subtitle: string;
  titleLabel: string;
  subtitleLabel: string;
  colorLabel: string;
}

export function starterScene(text: StarterText): PromoScene {
  return {
    id: null,
    name: text.name,
    html: STARTER_HTML,
    css: STARTER_CSS,
    js: STARTER_JS,
    params: [
      { key: 'title', type: 'text', label: text.titleLabel, value: text.title },
      { key: 'subtitle', type: 'text', label: text.subtitleLabel, value: text.subtitle },
      { key: 'color', type: 'color', label: text.colorLabel, value: '#ffffff' },
    ],
    assets: [],
    duration: 4,
  };
}

/** `{{key}}` names the HTML and CSS use that are not params yet. */
export function undeclaredKeys(scene: PromoScene): string[] {
  const declared = new Set(scene.params.map((param) => param.key));
  const found = new Set<string>();
  for (const match of `${scene.html}\n${scene.css}`.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)) {
    const key = match[1];
    if (!declared.has(key) && !RESERVED.has(key) && PARAM_KEY.test(key)) found.add(key);
  }
  return [...found];
}

/** A new param with a key that is free and valid. */
export function newParam(
  scene: PromoScene,
  type: PromoSceneParam['type'],
  key?: string,
): PromoSceneParam {
  const taken = new Set(scene.params.map((param) => param.key));
  const base = key && PARAM_KEY.test(key) && !RESERVED.has(key) ? key.slice(0, 28) : type;
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}_${n}`;
  return {
    key: candidate,
    type,
    label: candidate,
    value: type === 'color' ? '#ffffff' : '',
  };
}

export const validKey = (key: string) => PARAM_KEY.test(key) && !RESERVED.has(key);

/** Decoded size of a base64 string. */
export const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4);

export function assetProblem(scene: PromoScene, name: string, size: number): string | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name.startsWith('.')) return 'name';
  if (!ASSET_EXTENSIONS.includes(extension)) return 'type';
  if (scene.assets.length >= SCENE_LIMITS.assets) return 'count';
  if (size > SCENE_LIMITS.assetBytes) return 'size';
  const total = scene.assets.reduce((sum, asset) => sum + base64Bytes(asset.data), 0);
  if (total + size > SCENE_LIMITS.totalAssetBytes) return 'size';
  if (scene.assets.some((asset) => asset.name.toLowerCase() === name.toLowerCase())) return 'name';
  return null;
}

/** A file name the scene can store: unsafe characters become `-`. */
export const assetName = (file: string) =>
  file
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-80) || 'file';

export const codeBytes = (text: string) => new TextEncoder().encode(text).length;

/** A rendered full-frame scene as a shot that lasts the whole scene. */
export function sceneShot(media: PromoMedia, key: string, seconds: number): PromoShot {
  return {
    ...shotFor(media, key),
    duration: Math.min(MAX_SHOT_SECONDS, Math.max(0.5, media.duration ?? seconds)),
    motion: 'none',
    fit: 'cover',
  };
}

/** Problems that stop a preview or a render; mirrors `blocking` in main. */
export const blockingProblems = (problems: readonly PromoSceneProblem[]) =>
  problems.filter((problem) => problem.code !== 'timer_animation');

/** Same scene content, ignoring the saved id: used to tell unsaved edits. */
export const sameScene = (a: PromoScene | null, b: PromoScene | null) =>
  !!a && !!b && JSON.stringify({ ...a, id: null }) === JSON.stringify({ ...b, id: null });
