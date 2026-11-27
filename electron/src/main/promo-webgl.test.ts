// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeWebgl } from './promo-webgl';

function findChrome(): string | null {
  if (process.env.PROMO_CHROME_PATH) return process.env.PROMO_CHROME_PATH;
  const roots = [
    process.env.APPDATA && join(process.env.APPDATA, 'VoiceStudio'),
    join(homedir(), 'Library/Application Support/VoiceStudio'),
    join(homedir(), '.config/VoiceStudio'),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    const base = join(root, 'promo-browser', 'chrome-headless-shell');
    if (!existsSync(base)) continue;
    for (const version of readdirSync(base)) {
      for (const dir of readdirSync(join(base, version))) {
        for (const exe of ['chrome-headless-shell.exe', 'chrome-headless-shell']) {
          if (existsSync(join(base, version, dir, exe))) return join(base, version, dir, exe);
        }
      }
    }
  }
  return null;
}
const chrome = findChrome();

describe('WebGL probe', () => {
  it('reports a Chrome that cannot start as no WebGL, never as a crash', async () => {
    const verdict = await probeWebgl(join(homedir(), 'no-such-chrome', 'chrome'), 20_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toBeTruthy();
  }, 30_000);

  it.skipIf(!chrome)('draws with SwiftShader in Chrome Headless Shell under the render flags', async () => {
    const verdict = await probeWebgl(chrome!);
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.detail.toLowerCase()).toContain('swiftshader');
  }, 60_000);
});
