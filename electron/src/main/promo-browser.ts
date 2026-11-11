import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  type BrowserPlatform,
} from '@puppeteer/browsers';

/**
 * Chrome Headless Shell for animated promo templates.
 *
 * Downloaded only when the user turns animated templates on and confirms the
 * size (owner-approved; CLAUDE.md, Local-first). It lives in the app's own
 * data folder, never in Puppeteer's shared `~/.cache`, so the renderer only
 * ever uses the build the app installed.
 *
 * BUILD_ID equals PUPPETEER_REVISIONS['chrome-headless-shell'] of the
 * puppeteer-core version @hyperframes/producer pins; bump them together.
 */
export const BUILD_ID = '153.0.8010.36';
/** Shown before the download; the archive plus unpacked files, rounded up. */
export const DOWNLOAD_MEGABYTES = 271;

export type PromoBrowserState =
  | { state: 'unsupported' }
  | { state: 'missing'; downloadMegabytes: number }
  | { state: 'installing'; downloaded: number; total: number }
  | { state: 'ready'; executablePath: string }
  | { state: 'failed'; message: string; downloadMegabytes: number };

export interface PromoBrowserDeps {
  cacheDir: string;
  platform?: BrowserPlatform | undefined;
  exists?: (path: string) => boolean;
  installBrowser?: typeof install;
}

export function promoBrowserCacheDir(userData: string): string {
  return join(userData, 'promo-browser');
}

export class PromoBrowser {
  private readonly cacheDir: string;
  private readonly platform: BrowserPlatform | undefined;
  private readonly exists: (path: string) => boolean;
  private readonly installBrowser: typeof install;
  private installing: Promise<PromoBrowserState> | null = null;
  private progress = { downloaded: 0, total: 0 };
  private lastError: string | null = null;
  private readonly listeners = new Set<(state: PromoBrowserState) => void>();

  constructor(deps: PromoBrowserDeps) {
    this.cacheDir = deps.cacheDir;
    this.platform = 'platform' in deps ? deps.platform : detectBrowserPlatform();
    this.exists = deps.exists ?? existsSync;
    this.installBrowser = deps.installBrowser ?? install;
  }

  /** Path the shell runs from once installed, or null on a platform without a build. */
  executablePath(): string | null {
    if (!this.platform) return null;
    return computeExecutablePath({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: BUILD_ID,
      cacheDir: this.cacheDir,
      platform: this.platform,
    });
  }

  get state(): PromoBrowserState {
    const path = this.executablePath();
    if (!path) return { state: 'unsupported' };
    if (this.installing) return { state: 'installing', ...this.progress };
    if (this.exists(path)) return { state: 'ready', executablePath: path };
    if (this.lastError) {
      return { state: 'failed', message: this.lastError, downloadMegabytes: DOWNLOAD_MEGABYTES };
    }
    return { state: 'missing', downloadMegabytes: DOWNLOAD_MEGABYTES };
  }

  subscribe(listener: (state: PromoBrowserState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  /** Downloads the shell. Concurrent calls share one download. */
  install(): Promise<PromoBrowserState> {
    if (this.installing) return this.installing;
    const platform = this.platform;
    if (!platform) return Promise.resolve(this.state);
    if (this.state.state === 'ready') return Promise.resolve(this.state);
    this.lastError = null;
    this.progress = { downloaded: 0, total: 0 };
    let lastEmit = 0;
    this.installing = (async () => {
      try {
        await this.installBrowser({
          browser: Browser.CHROMEHEADLESSSHELL,
          buildId: BUILD_ID,
          cacheDir: this.cacheDir,
          platform,
          downloadProgressCallback: (downloaded, total) => {
            this.progress = { downloaded, total };
            const now = Date.now();
            if (now - lastEmit > 200 || downloaded >= total) {
              lastEmit = now;
              this.emit();
            }
          },
        });
        const path = this.executablePath();
        if (!path || !this.exists(path)) throw new Error('browser_missing_after_install');
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        this.installing = null;
      }
      const state = this.state;
      this.emit();
      return state;
    })();
    this.emit();
    return this.installing;
  }
}
