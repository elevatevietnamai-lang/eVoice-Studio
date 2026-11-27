import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Motion libraries a custom scene may import, bundled with the app.
 *
 * A scene writes `import { animate } from "evoice:anime"`. The page that runs
 * it (promo-scenes.ts, sceneDocument) carries an import map whose entries are
 * `data:` URLs of the library files read from this app's own node_modules, so
 * nothing is fetched from anywhere: the preview and the render load the very
 * same bytes from the page itself, and the scene's no-network policy holds.
 *
 * Each library comes with a small adapter module that puts every animation it
 * makes on the scene's clock: animations are created paused and moved to the
 * scene time on every `scene.onFrame(t)` (Motion and Web Animations: `time`;
 * Anime.js: `seek`; dotLottie: `setFrame`; three.js scenes render from their
 * own onFrame). HyperFrames seeks that clock frame by frame in a render and
 * the preview drives it from the wall clock, so the video matches the preview
 * frame for frame. Nothing here touches HyperFrames' own adapters
 * (`window.anime`, `window.lottie`, `window.THREE`, `__hf*`), which the
 * preview does not have.
 */

export const SCENE_LIBRARIES = ['motion', 'anime', 'lottie', 'three'] as const;
export type SceneLibrary = (typeof SCENE_LIBRARIES)[number];

/** Libraries that draw with WebGL; the render checks the GPU first. */
export const WEBGL_LIBRARIES: readonly SceneLibrary[] = ['three'];

const SPECIFIER = /(["'])evoice:([a-z0-9/_-]+)\1/gi;

/** `evoice:` modules a scene's code names, known or not. */
export function importedModules(js: string): string[] {
  return [...new Set([...js.matchAll(SPECIFIER)].map((match) => match[2].toLowerCase()))];
}

/** The bundled libraries a scene uses, in a fixed order. */
export function usedLibraries(js: string): SceneLibrary[] {
  const named = new Set(importedModules(js));
  return SCENE_LIBRARIES.filter((library) => named.has(library));
}

/** Modules a scene names that the app does not bundle. */
export function unknownModules(js: string): string[] {
  return importedModules(js).filter(
    (name) => !(SCENE_LIBRARIES as readonly string[]).includes(name),
  );
}

/**
 * True when the scene's code has to run as a module: a static
 * `import … from "evoice:…"` (or `export`) is only valid there. Scenes
 * without one keep running as a classic script, exactly as before.
 */
export function needsModule(js: string): boolean {
  return /(?:^|[\n;])\s*(?:import\s*(?:[\w*{$]|["'])|export\s)/.test(js);
}

// ── Library files ───────────────────────────────────────────────────────────

const moduleRequire = createRequire(import.meta.url);

/** The installed package's folder, found from its entry point. */
export function packageDir(name: string): string {
  // A package whose `exports` hides its manifest or has no `require` entry
  // is found on the module search path instead.
  for (const base of moduleRequire.resolve.paths(name) ?? []) {
    if (existsSync(join(base, name, 'package.json'))) return join(base, name);
  }
  let dir = dirname(moduleRequire.resolve(name));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === name) {
          return dir;
        }
      } catch {
        // A partial manifest (dist/package.json {"type": …}): keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package_not_found:${name}`);
    dir = parent;
  }
}

const read = (pkg: string, file: string) => readFileSync(join(packageDir(pkg), file), 'utf8');

/**
 * Defaults inside a library that would name a CDN. The page blocks every
 * request anyway; rewriting them means a policy slip could not reach one.
 */
const neutralizeCdn = (source: string) =>
  source.replace(/https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com)\/[^`"']*/g, 'about:blank');

/** A scene's view of the shared scene clock, used by every adapter. */
const CLOCK = `const scene = window.scene;
let now = 0;
const tick = new Set();
scene.onFrame((t) => { now = t; for (const fn of tick) fn(t); });`;

const MOTION_EXPORTS = [
  'spring',
  'stagger',
  'delay',
  'cubicBezier',
  'steps',
  'easeIn',
  'easeOut',
  'easeInOut',
  'backIn',
  'backOut',
  'backInOut',
  'circIn',
  'circOut',
  'circInOut',
  'anticipate',
  'mirrorEasing',
  'reverseEasing',
  'interpolate',
  'mix',
  'transform',
  'wrap',
  'clamp',
  'progress',
  'distance',
  'motionValue',
  'styleEffect',
  'attrEffect',
  'svgEffect',
  'propEffect',
  'mapValue',
  'transformValue',
  'springValue',
];

/**
 * Motion: every `animate()` result is paused and moved to the scene time.
 * Animations are placed on the scene's timeline from 0; `delay` starts one
 * later. The JS-driven ones (springs on values the compositor cannot animate)
 * write their value when `time` is set, the WAAPI ones through currentTime.
 */
const MOTION_ADAPTER = `import 'evoice:motion/lib';
const M = globalThis.Motion;
${CLOCK}
const tracked = new Set();
function place(c) {
  try { c.time = now; } catch (e) { console.error(e); }
}
function track(c) {
  if (!c || typeof c.pause !== 'function') return c;
  c.pause();
  place(c);
  tracked.add(c);
  return c;
}
tick.add(() => { for (const c of tracked) place(c); });
export function animate(...args) { return track(M.animate(...args)); }
export const { ${MOTION_EXPORTS.join(', ')} } = M;
export default M;
`;

/**
 * Anime.js v4: the engine's own loop is off, every animation, timeline and
 * timer is created paused and sought to the scene time.
 */
const ANIME_ADAPTER = `import * as A from 'evoice:anime/lib';
export * from 'evoice:anime/lib';
${CLOCK}
try { A.engine.useDefaultMainLoop = false; } catch (e) { console.error(e); }
const unit = () => (A.engine.timeUnit === 's' ? 1 : 1000);
// seek() counts from after the animation's own delay; the scene clock
// counts from 0, so a delayed animation is sought earlier by its delay.
const at = (x, t) => t * unit() - (typeof x._delay === 'number' ? x._delay : 0);
const tracked = new Set();
function track(x) {
  if (!x) return x;
  try { x.pause(); x.seek(at(x, now), true); } catch (e) { console.error(e); }
  tracked.add(x);
  return x;
}
const paused = (p) => Object.assign({}, p, { autoplay: false });
tick.add((t) => { for (const x of tracked) { try { x.seek(at(x, t)); } catch (e) { console.error(e); } } });
export function animate(targets, params) { return track(A.animate(targets, paused(params))); }
export function createTimeline(params) { return track(A.createTimeline(paused(params))); }
export function createTimer(params) { return track(A.createTimer(paused(params))); }
export const waapi = Object.assign({}, A.waapi, {
  animate(targets, params) { return track(A.waapi.animate(targets, paused(params))); },
});
`;

/**
 * dotLottie: the player loads its renderer from the page (never a CDN),
 * never plays on its own, and shows the frame for the scene time. The first
 * frame waits until the animation has loaded.
 */
const LOTTIE_ADAPTER = `import { DotLottie as Player } from 'evoice:lottie/lib';
export * from 'evoice:lottie/lib';
${CLOCK}
const wasm = document.getElementById('evoice-lottie-wasm');
Player.setWasmUrl('data:application/wasm;base64,' + (wasm ? wasm.textContent.trim() : ''));
const players = new Set();
export function frameAt(player, t) {
  const total = player.totalFrames;
  const length = player.duration;
  if (!(total > 0) || !(length > 0)) return null;
  let frame = (Math.max(0, t) * (player.speed || 1) * total) / length;
  if (player.loop) frame %= total;
  return Math.min(frame, total - 1);
}
function show(player, t) {
  if (!player.isLoaded) return;
  const frame = frameAt(player, t);
  if (frame !== null) player.setFrame(frame);
}
export class DotLottie extends Player {
  constructor(config) {
    super(Object.assign({}, config, {
      autoplay: false,
      renderConfig: Object.assign(
        { devicePixelRatio: 1, freezeOnOffscreen: false, autoResize: false },
        config && config.renderConfig,
      ),
    }));
    players.add(this);
    scene.ready(new Promise((resolve) => {
      this.addEventListener('load', () => { show(this, now); resolve(); });
      this.addEventListener('loadError', (e) => { console.error('lottie', e); resolve(); });
    }));
  }
}
tick.add((t) => { for (const p of players) show(p, t); });
`;

interface LibraryFiles {
  /** `evoice:<name>` → module source. */
  modules: Record<string, string>;
  /** Extra inert elements the adapter reads (dotLottie's wasm). */
  head: string;
}

const cache = new Map<SceneLibrary, LibraryFiles>();

function load(library: SceneLibrary): LibraryFiles {
  const known = cache.get(library);
  if (known) return known;
  let files: LibraryFiles;
  switch (library) {
    case 'motion':
      files = {
        modules: { motion: MOTION_ADAPTER, 'motion/lib': read('motion', 'dist/motion.js') },
        head: '',
      };
      break;
    case 'anime':
      files = {
        modules: {
          anime: ANIME_ADAPTER,
          'anime/lib': read('animejs', 'dist/bundles/anime.esm.min.js'),
        },
        head: '',
      };
      break;
    case 'lottie': {
      const wasm = readFileSync(
        join(packageDir('@lottiefiles/dotlottie-web'), 'dist/dotlottie-player.wasm'),
      ).toString('base64');
      files = {
        modules: {
          lottie: LOTTIE_ADAPTER,
          'lottie/lib': neutralizeCdn(read('@lottiefiles/dotlottie-web', 'dist/index.js')),
        },
        head: `<script type="application/octet-stream" id="evoice-lottie-wasm">${wasm}</script>`,
      };
      break;
    }
    case 'three':
      files = {
        modules: {
          three: read('three', 'build/three.module.js').replace(
            /(["'])\.\/three\.core\.js\1/g,
            '"evoice:three/core"',
          ),
          'three/core': read('three', 'build/three.core.js'),
        },
        head: '',
      };
      break;
  }
  cache.set(library, files);
  return files;
}

const moduleUrl = (source: string) =>
  `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;

/**
 * What goes into the page's `<head>` for the libraries a scene uses: the
 * import map (before any module script) and the adapters' inert data.
 * Empty when the scene uses none.
 */
export function libraryHead(libraries: readonly SceneLibrary[]): string {
  if (!libraries.length) return '';
  const imports: Record<string, string> = {};
  const extra: string[] = [];
  for (const library of libraries) {
    const files = load(library);
    for (const [name, source] of Object.entries(files.modules)) {
      imports[`evoice:${name}`] = moduleUrl(source);
    }
    if (files.head) extra.push(files.head);
  }
  return `<script type="importmap">${JSON.stringify({ imports })}</script>\n${extra.join('\n')}`;
}
