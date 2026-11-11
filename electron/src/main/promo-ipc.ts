import { join } from 'node:path';
import {
  app,
  ipcMain,
  utilityProcess,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import type { BackendSupervisor } from './backend';
import { PromoBrowser, promoBrowserCacheDir, type PromoBrowserState } from './promo-browser';
import { PromoRenderError, renderPromoOverlay, type RenderChild } from './promo-render';
import { parseTemplateInput, TemplateInputError } from './promo-templates';
import { sendToLiveWindow } from './window-safety';

export const PROMO_CHANNELS = {
  browserState: 'promo:browserState',
  browserInstall: 'promo:browserInstall',
  browserChanged: 'promo:browserChanged',
  renderOverlay: 'promo:renderOverlay',
  renderCancel: 'promo:renderCancel',
  renderProgress: 'promo:renderProgress',
} as const;

export type PromoOverlayResult =
  | { ok: true; media: import('./promo-render').PromoMediaResult }
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
      const controller = new AbortController();
      rendering = controller;
      const owner = getMainWindow();
      try {
        const media = await renderPromoOverlay(
          input,
          {
            baseUrl: supervisor.baseUrl,
            headers: supervisor.requestHeaders(),
            chromePath: state.executablePath,
            fontsDir: join(backendRoot(), 'backend', 'assets', 'fonts'),
            tempRoot: join(app.getPath('temp'), 'voicestudio-promo'),
            spawn: (env) =>
              utilityProcess.fork(
                join(app.getAppPath(), 'out', 'main', 'promo-render-worker.js'),
                [],
                { env, serviceName: 'Promo template renderer', stdio: 'ignore' },
              ) as unknown as RenderChild,
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
    },
  );
}
