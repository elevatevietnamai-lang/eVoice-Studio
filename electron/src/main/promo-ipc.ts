import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  dialog,
  ipcMain,
  utilityProcess,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import type { BackendSupervisor } from './backend';
import { PromoBrowser, promoBrowserCacheDir, type PromoBrowserState } from './promo-browser';
import {
  fetchLogo,
  PromoRenderError,
  renderPromoOverlay,
  renderPromoScene,
  sceneImages,
  type PromoMediaResult,
  type PromoRenderDeps,
  type RenderChild,
  type RenderOptions,
} from './promo-render';
import { installScenePreviewProtocol, ScenePreviews } from './promo-scene-protocol';
import {
  assetsFontUri,
  blocking,
  exportFileName,
  exportScene,
  importScene,
  lintScene,
  MAX_SCENE_FILE_BYTES,
  parseScene,
  parseSide,
  SCENE_ID,
  sceneDocument,
  SceneInputError,
  SceneStore,
  type PromoScene,
  type SceneProblem,
  type SceneSummary,
} from './promo-scenes';
import { parseTemplateInput, previewHtml, TemplateInputError } from './promo-templates';
import { sendToLiveWindow } from './window-safety';

export const PROMO_CHANNELS = {
  browserState: 'promo:browserState',
  browserInstall: 'promo:browserInstall',
  browserChanged: 'promo:browserChanged',
  renderOverlay: 'promo:renderOverlay',
  renderCancel: 'promo:renderCancel',
  renderProgress: 'promo:renderProgress',
  previewTemplate: 'promo:previewTemplate',
  sceneList: 'promo:sceneList',
  sceneGet: 'promo:sceneGet',
  sceneSave: 'promo:sceneSave',
  sceneDelete: 'promo:sceneDelete',
  sceneImport: 'promo:sceneImport',
  sceneExport: 'promo:sceneExport',
  scenePreview: 'promo:scenePreview',
  sceneRender: 'promo:sceneRender',
} as const;

export type SceneFailure = { ok: false; code: string; detail?: string };
export type SceneSaveResult = { ok: true; scene: PromoScene } | SceneFailure;
export type SceneImportResult =
  | { ok: true; scene: PromoScene; problems: SceneProblem[] }
  | { ok: false; code: 'cancelled' }
  | SceneFailure;
export type SceneExportResult = { ok: true } | { ok: false; code: 'cancelled' } | SceneFailure;
export type ScenePreviewResult =
  | { ok: true; url: string; problems: SceneProblem[] }
  | (SceneFailure & { problems?: SceneProblem[] });
export type SceneRenderResult =
  | { ok: true; media: PromoMediaResult }
  | (SceneFailure & { problems?: SceneProblem[] });
export type { SceneSummary };

/** A failure the renderer can show: bad input, a scene problem, a render error. */
function sceneFailure(error: unknown): SceneFailure {
  if (error instanceof SceneInputError) {
    return { ok: false, code: 'invalid_scene', detail: error.field };
  }
  if (error instanceof PromoRenderError) return { ok: false, code: error.code };
  return { ok: false, code: 'scene_failed', detail: String(error) };
}

/** Scene, frame size and render mode, checked. Throws SceneInputError. */
export function parseSceneRequest(raw: unknown): {
  scene: PromoScene;
  width: number;
  height: number;
  mode: 'overlay' | 'shot';
} {
  if (!raw || typeof raw !== 'object') throw new SceneInputError('request');
  const input = raw as Record<string, unknown>;
  return {
    scene: parseScene(input.scene),
    width: parseSide(input.width, 'width'),
    height: parseSide(input.height, 'height'),
    mode: input.mode === 'shot' ? 'shot' : 'overlay',
  };
}

export type PromoOverlayResult =
  | { ok: true; media: import('./promo-render').PromoMediaResult }
  | { ok: false; code: string; detail?: string };

export type PromoPreviewResult =
  | { ok: true; html: string }
  | { ok: false; code: string; detail?: string };

const ALLOWED_FPS = new Set([30, 60]);

export function registerPromoIpc(
  supervisor: BackendSupervisor,
  getMainWindow: () => BrowserWindow | null,
  assertTrusted: (event: IpcMainInvokeEvent, owner: BrowserWindow | null) => void,
  backendRoot: () => string,
): void {
  const browser = new PromoBrowser({ cacheDir: promoBrowserCacheDir(app.getPath('userData')) });
  browser.subscribe((state: PromoBrowserState) =>
    sendToLiveWindow(getMainWindow(), PROMO_CHANNELS.browserChanged, state),
  );
  let rendering: AbortController | null = null;

  const trusted = (event: IpcMainInvokeEvent) => assertTrusted(event, getMainWindow());

  ipcMain.handle(PROMO_CHANNELS.browserState, (event) => {
    trusted(event);
    return browser.state;
  });
  ipcMain.handle(PROMO_CHANNELS.browserInstall, (event) => {
    trusted(event);
    return browser.install();
  });
  ipcMain.handle(
    PROMO_CHANNELS.previewTemplate,
    async (event, raw: unknown): Promise<PromoPreviewResult> => {
      trusted(event);
      try {
        const input = parseTemplateInput(raw);
        const logo = input.logoId
          ? await fetchLogo(
              { baseUrl: supervisor.baseUrl, headers: supervisor.requestHeaders() },
              input.logoId,
            )
          : undefined;
        return {
          ok: true,
          html: previewHtml(input, join(backendRoot(), 'backend', 'assets'), logo),
        };
      } catch (error) {
        if (error instanceof TemplateInputError) {
          return { ok: false, code: 'invalid_input', detail: error.field };
        }
        if (error instanceof PromoRenderError) return { ok: false, code: error.code };
        return { ok: false, code: 'preview_failed', detail: String(error) };
      }
    },
  );
  const scenes = new SceneStore(join(app.getPath('userData'), 'promo-scenes'));
  const previews = new ScenePreviews();
  installScenePreviewProtocol(previews);
  const backendDeps = () => ({ baseUrl: supervisor.baseUrl, headers: supervisor.requestHeaders() });

  ipcMain.handle(PROMO_CHANNELS.sceneList, (event): SceneSummary[] => {
    trusted(event);
    return scenes.list();
  });
  ipcMain.handle(PROMO_CHANNELS.sceneGet, (event, id: unknown): PromoScene | null => {
    trusted(event);
    if (typeof id !== 'string' || !SCENE_ID.test(id)) return null;
    try {
      return scenes.get(id);
    } catch {
      return null;
    }
  });
  ipcMain.handle(PROMO_CHANNELS.sceneSave, (event, raw: unknown): SceneSaveResult => {
    trusted(event);
    try {
      return { ok: true, scene: scenes.save(parseScene(raw)) };
    } catch (error) {
      return sceneFailure(error);
    }
  });
  ipcMain.handle(PROMO_CHANNELS.sceneDelete, (event, id: unknown) => {
    trusted(event);
    if (typeof id === 'string' && SCENE_ID.test(id)) scenes.remove(id);
  });
  ipcMain.handle(PROMO_CHANNELS.sceneImport, async (event): Promise<SceneImportResult> => {
    trusted(event);
    const owner = getMainWindow();
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'Scene', extensions: ['html', 'htm', 'zip'] }],
    };
    const picked = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const path = picked.filePaths[0];
    if (picked.canceled || !path) return { ok: false, code: 'cancelled' };
    try {
      // Checked before reading, so a huge file is never loaded.
      if ((await stat(path)).size > MAX_SCENE_FILE_BYTES) {
        return { ok: false, code: 'invalid_scene', detail: 'file_too_large' };
      }
      const scene = importScene(path, new Uint8Array(await readFile(path)));
      return { ok: true, scene, problems: lintScene(scene) };
    } catch (error) {
      return sceneFailure(error);
    }
  });
  ipcMain.handle(
    PROMO_CHANNELS.sceneExport,
    async (event, raw: unknown): Promise<SceneExportResult> => {
      trusted(event);
      let file: { extension: 'zip' | 'html'; data: Uint8Array };
      let scene: PromoScene;
      try {
        scene = parseScene(raw);
        file = exportScene(scene);
      } catch (error) {
        return sceneFailure(error);
      }
      const owner = getMainWindow();
      const options = {
        defaultPath: exportFileName(scene, file.extension),
        filters: [{ name: 'Scene', extensions: [file.extension] }],
      };
      const picked = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return { ok: false, code: 'cancelled' };
      try {
        await writeFile(picked.filePath, file.data);
        return { ok: true };
      } catch (error) {
        return { ok: false, code: 'write_failed', detail: String(error) };
      }
    },
  );
  ipcMain.handle(
    PROMO_CHANNELS.scenePreview,
    async (event, raw: unknown): Promise<ScenePreviewResult> => {
      trusted(event);
      try {
        const request = parseSceneRequest(raw);
        const problems = lintScene(request.scene);
        if (blocking(problems).length) return { ok: false, code: 'scene_problems', problems };
        const images = await sceneImages(backendDeps(), request.scene);
        const html = sceneDocument(request.scene, {
          width: request.width,
          height: request.height,
          mode: 'preview',
          fontUri: assetsFontUri(join(backendRoot(), 'backend', 'assets')),
          images,
        });
        return { ok: true, url: previews.add(html), problems };
      } catch (error) {
        return sceneFailure(error);
      }
    },
  );

  ipcMain.handle(PROMO_CHANNELS.renderCancel, (event) => {
    trusted(event);
    rendering?.abort();
  });
  ipcMain.handle(
    PROMO_CHANNELS.renderOverlay,
    async (event, raw: unknown, fps: unknown): Promise<PromoOverlayResult> => {
      trusted(event);
      if (rendering) return { ok: false, code: 'busy' };
      if (supervisor.connection.remote) return { ok: false, code: 'local_backend_required' };
      const state = browser.state;
      if (state.state !== 'ready') return { ok: false, code: 'browser_missing' };
      let input;
      try {
        input = parseTemplateInput(raw);
      } catch (error) {
        if (error instanceof TemplateInputError) {
          return { ok: false, code: 'invalid_input', detail: error.field };
        }
        throw error;
      }
      return runRender(fps, (deps, options) => renderPromoOverlay(input, deps, options));
    },
  );
  ipcMain.handle(
    PROMO_CHANNELS.sceneRender,
    async (event, raw: unknown, fps: unknown): Promise<SceneRenderResult> => {
      trusted(event);
      if (rendering) return { ok: false, code: 'busy' };
      if (supervisor.connection.remote) return { ok: false, code: 'local_backend_required' };
      if (browser.state.state !== 'ready') return { ok: false, code: 'browser_missing' };
      let request: ReturnType<typeof parseSceneRequest>;
      try {
        request = parseSceneRequest(raw);
      } catch (error) {
        return sceneFailure(error);
      }
      const problems = lintScene(request.scene);
      if (blocking(problems).length) return { ok: false, code: 'scene_problems', problems };
      return runRender(fps, (deps, options) =>
        renderPromoScene(request.scene, request, deps, options),
      );
    },
  );

  /** One render at a time, in a utility process, with progress sent to the window. */
  async function runRender(
    fps: unknown,
    render: (deps: PromoRenderDeps, options: RenderOptions) => Promise<PromoMediaResult>,
  ): Promise<PromoOverlayResult> {
    const state = browser.state;
    if (state.state !== 'ready') return { ok: false, code: 'browser_missing' };
    const controller = new AbortController();
    rendering = controller;
    const owner = getMainWindow();
    let stderrTail = '';
    try {
      const media = await render(
        {
          ...backendDeps(),
          chromePath: state.executablePath,
          assetsDir: join(backendRoot(), 'backend', 'assets'),
          tempRoot: join(app.getPath('temp'), 'voicestudio-promo'),
          spawn: (env) => {
            // Beside the main bundle in dev, preview and the packaged asar alike.
            const child = utilityProcess.fork(
              fileURLToPath(new URL('./promo-render-worker.js', import.meta.url)),
              [],
              {
                env,
                serviceName: 'Promo template renderer',
                stdio: ['ignore', 'ignore', 'pipe'],
              },
            );
            child.stderr?.on('data', (chunk: Buffer) => {
              stderrTail = (stderrTail + chunk.toString()).slice(-4000);
            });
            return child as unknown as RenderChild;
          },
        },
        {
          fps: typeof fps === 'number' && ALLOWED_FPS.has(fps) ? fps : 30,
          signal: controller.signal,
          onProgress: (progress) =>
            sendToLiveWindow(owner, PROMO_CHANNELS.renderProgress, progress),
        },
      );
      return { ok: true, media };
    } catch (error) {
      if (stderrTail) console.warn('[promo] render worker stderr:\n' + stderrTail);
      if (error instanceof PromoRenderError) {
        if (error.blocked.length) {
          console.warn('[promo] blocked network attempts', JSON.stringify(error.blocked));
        }
        return { ok: false, code: error.code, detail: error.message };
      }
      return { ok: false, code: 'render_failed', detail: String(error) };
    } finally {
      rendering = null;
    }
  }
}
