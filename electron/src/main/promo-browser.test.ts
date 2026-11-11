// @vitest-environment node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserPlatform } from '@puppeteer/browsers';
import { describe, expect, it, vi } from 'vitest';
import { BUILD_ID, DOWNLOAD_MEGABYTES, PromoBrowser, promoBrowserCacheDir } from './promo-browser';

const cacheDir = promoBrowserCacheDir(join('/data', 'VoiceStudio'));

describe('PromoBrowser', () => {
  it('keeps the shell in the app data folder, never the shared Puppeteer cache', () => {
    const browser = new PromoBrowser({
      cacheDir,
      platform: BrowserPlatform.WIN64,
      exists: () => false,
    });
    const path = browser.executablePath()!;
    expect(path.startsWith(cacheDir)).toBe(true);
    expect(path).toContain(BUILD_ID);
    expect(path).not.toContain('.cache');
  });

  it('reports unsupported when no build exists for the platform', () => {
    const browser = new PromoBrowser({ cacheDir, platform: undefined });
    expect(browser.state).toEqual({ state: 'unsupported' });
  });

  it('asks before downloading and shares one download between callers', async () => {
    let installed = false;
    let finish: () => void = () => {};
    const installBrowser = vi.fn(
      (options: { downloadProgressCallback: (a: number, b: number) => void }) =>
        new Promise<void>((resolve) => {
          options.downloadProgressCallback(50, 100);
          finish = () => {
            installed = true;
            resolve();
          };
        }),
    );
    const browser = new PromoBrowser({
      cacheDir,
      platform: BrowserPlatform.LINUX,
      exists: () => installed,
      installBrowser: installBrowser as never,
    });
    expect(browser.state).toEqual({ state: 'missing', downloadMegabytes: DOWNLOAD_MEGABYTES });
    const states: string[] = [];
    browser.subscribe((state) => states.push(state.state));

    const first = browser.install();
    const second = browser.install();
    expect(browser.state).toEqual({ state: 'installing', downloaded: 50, total: 100 });
    finish();
    expect(await first).toMatchObject({ state: 'ready' });
    expect(await second).toMatchObject({ state: 'ready' });
    expect(installBrowser).toHaveBeenCalledTimes(1);
    expect(installBrowser.mock.calls[0][0]).toMatchObject({ buildId: BUILD_ID, cacheDir });
    expect(states.at(-1)).toBe('ready');
  });

  it('reports a failed download and lets the user retry', async () => {
    const browser = new PromoBrowser({
      cacheDir,
      platform: BrowserPlatform.MAC_ARM,
      exists: () => false,
      installBrowser: (async () => {
        throw new Error('ETIMEDOUT');
      }) as never,
    });
    expect(await browser.install()).toEqual({
      state: 'failed',
      message: 'ETIMEDOUT',
      downloadMegabytes: DOWNLOAD_MEGABYTES,
    });
  });

  it('pins the same headless shell build as the puppeteer-core HyperFrames uses', () => {
    // Bun's isolated layout puts producer's puppeteer-core beside it; a hoisted
    // layout puts it at the top. Either way the test must find it.
    const producer = realpathSync(
      join(__dirname, '..', '..', 'node_modules', '@hyperframes', 'producer'),
    );
    const candidates = [
      join(producer, '..', '..', 'puppeteer-core'),
      join(__dirname, '..', '..', '..', 'node_modules', 'puppeteer-core'),
      join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'),
    ].map((dir) => join(dir, 'lib', 'puppeteer', 'revisions.js'));
    const file = candidates.find((path) => existsSync(path));
    expect(file, 'puppeteer-core revisions.js').toBeDefined();
    const pinned = /'chrome-headless-shell':\s*'([^']+)'/.exec(readFileSync(file!, 'utf8'))?.[1];
    expect(pinned).toBe(BUILD_ID);
  });
});
