/**
 * Screenshots for the Vietnamese user guide (docs/huong-dan/<slug>/).
 *
 *   bun run docs:capture                  every scenario
 *   bun run docs:capture clone dub        only these slugs
 *   bun run docs:capture --theme light    light theme instead of dark
 *
 * Each scenario runs in its own app launch through the desktop harness, so the request guard
 * (nothing leaves the machine), the console-error guard and the fake backend all apply. The app
 * runs in Vietnamese at a fixed 1440×900 content size with animations off, on demo fixtures.
 * A failing scenario is reported and the next one still runs; the exit code is non-zero.
 *
 * Output per slug: shots/<step>.png plus manifest.json (route, file, size, hash, and the
 * headings, buttons and labels visible in the shot). Before a shot is kept, the page text is
 * scanned for personal data (Windows user name, e-mail, Hugging Face token, user paths).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withApp } from '../desktop-harness.mjs';
import { DEMO_FIXTURES } from './fixtures.mjs';
import { findPersonalData } from './pii.mjs';
import { vi } from './vi.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '../../..');
const OUT_ROOT = join(workspaceRoot, 'docs/huong-dan');
const WIDTH = 1440;
const HEIGHT = 900;
const APP_VERSION = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')).version;
const FREEZE_CSS = `*,*::before,*::after{transition:none!important;animation:none!important;
caret-color:transparent!important;scroll-behavior:auto!important}`;

const args = process.argv.slice(2);
const themeMode = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : 'dark';
const wanted = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--theme');

async function loadScenarios() {
  const dir = join(here, 'scenarios');
  const all = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .sort()) {
    all.push((await import(pathToFileURL(join(dir, file)).href)).default);
  }
  return all
    .filter((scenario) => !wanted.length || wanted.includes(scenario.slug))
    .sort((a, b) => a.order - b.order);
}

/** Waits until the route has rendered and nothing is loading or moving. */
async function settle(page) {
  await page.locator('main, [role=alert]').first().waitFor({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 8000 })
    .catch(() => {});
  await page.addStyleTag({ content: FREEZE_CSS });
  // Blur so no focus ring or caret lands in the shot.
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
  await page.waitForTimeout(400);
}

async function go(page, route) {
  await page.evaluate((path) => {
    location.hash = '#' + path;
  }, route);
  await page.waitForFunction((path) => location.hash.startsWith('#' + path), route, {
    timeout: 8000,
  });
}

/** Headings, buttons, links and form labels currently visible; context for the writer. */
async function visibleLabels(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    };
    const name = (el) =>
      (
        el.getAttribute('aria-label') ||
        (el.labels && el.labels[0]?.innerText) ||
        el.getAttribute('placeholder') ||
        el.innerText ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    const collect = (selector) => [
      ...new Set(
        [...document.querySelectorAll(selector)]
          .filter(visible)
          .map(name)
          .filter((text) => text && text.length <= 80),
      ),
    ];
    return {
      title: document.title,
      headings: collect('h1,h2,h3,h4,[role=heading]'),
      buttons: collect('button,[role=button],[role=tab],[role=menuitem]'),
      links: collect('a[href]'),
      fields: collect('input,textarea,select,[role=combobox],[role=switch],[role=checkbox]'),
    };
  });
}

async function highlight(page, selector) {
  if (!selector) return () => {};
  const target = typeof selector === 'function' ? selector(page) : page.locator(selector).first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const handle = await target.elementHandle({ timeout: 5000 });
  await page.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.id = '__docs_highlight';
    Object.assign(box.style, {
      position: 'fixed',
      left: `${rect.left - 6}px`,
      top: `${rect.top - 6}px`,
      width: `${rect.width + 12}px`,
      height: `${rect.height + 12}px`,
      border: '3px solid #ff5a36',
      borderRadius: '10px',
      boxShadow: '0 0 0 4px rgba(255,90,54,.25)',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    document.body.append(box);
  }, handle);
  return () => page.evaluate(() => document.getElementById('__docs_highlight')?.remove());
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function captureScenario(scenario) {
  const dir = join(OUT_ROOT, scenario.slug);
  const shotsDir = join(dir, 'shots');
  rmSync(shotsDir, { recursive: true, force: true });
  mkdirSync(shotsDir, { recursive: true });
  // A neutral profile directory: no user name in any path the app might show.
  const profile = join(workspaceRoot, '.docs-capture', 'profile', scenario.slug);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const steps = [];
  await withApp(
    { name: `docs-capture-${scenario.slug}` },
    {
      profile,
      appVersion: APP_VERSION,
      seed: { locale: 'vi', theme: { mode: themeMode, light: 'default', dark: 'default' } },
      extraArgs: ['--force-device-scale-factor=1'],
      window: { width: WIDTH, height: HEIGHT },
      fixtures: { ...DEMO_FIXTURES, ...scenario.fixtures },
    },
    async ({ page }) => {
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      // The seed only fills gaps on load; if the first window raced it, write it and reload,
      // otherwise a shot can land on the English first-run wizard.
      const reseeded = await page.evaluate(() => {
        const want = { 'voicestudio.locale': 'vi', 'voicestudio.setup.complete.v1': '1' };
        let changed = false;
        for (const [key, value] of Object.entries(want)) {
          if (localStorage.getItem(key) !== value) {
            localStorage.setItem(key, value);
            changed = true;
          }
        }
        return changed;
      });
      if (reseeded) await page.reload();
      await page.waitForFunction(() => document.documentElement.lang?.startsWith('vi'), null, {
        timeout: 15000,
      });
      for (const step of scenario.steps) {
        if (step.route) await go(page, step.route);
        await settle(page);
        if (step.do) {
          await step.do({ page, vi });
          await settle(page);
        }
        const clear = await highlight(page, step.highlight);
        const labels = await visibleLabels(page);
        const text = await page.evaluate(() => document.body.innerText);
        const leaks = findPersonalData([text, JSON.stringify(labels)].join('\n'), {
          username: userInfo().username,
        });
        if (leaks.length) {
          throw new Error(`Personal data in ${scenario.slug}/${step.id}: ${leaks.join(', ')}`);
        }
        const png = await page.screenshot({
          path: join(shotsDir, `${step.id}.png`),
          mask: [page.locator('[data-docs-mask]')],
        });
        await clear();
        const size = pngSize(png);
        if (size.width !== WIDTH || size.height !== HEIGHT) {
          throw new Error(
            `${scenario.slug}/${step.id} is ${size.width}×${size.height}, expected ${WIDTH}×${HEIGHT}`,
          );
        }
        steps.push({
          id: step.id,
          caption: step.caption,
          route: await page.evaluate(() => location.hash.slice(1)),
          file: `shots/${step.id}.png`,
          ...size,
          sha256: createHash('sha256').update(png).digest('hex'),
          highlight: step.highlightLabel ?? null,
          labels,
        });
      }
    },
  );
  const manifest = {
    slug: scenario.slug,
    title: scenario.title,
    order: scenario.order,
    app_version: APP_VERSION,
    theme: themeMode,
    viewport: { width: WIDTH, height: HEIGHT },
    steps,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return steps.length;
}

const scenarios = await loadScenarios();
if (!scenarios.length) {
  console.error(`No scenario matches: ${wanted.join(', ')}`);
  process.exit(2);
}
const failed = [];
for (const scenario of scenarios) {
  try {
    const count = await captureScenario(scenario);
    console.log(`ok   ${scenario.slug} (${count} shots)`);
  } catch (error) {
    failed.push(scenario.slug);
    console.error(`FAIL ${scenario.slug}: ${error?.stack ?? error}`);
  }
}
rmSync(join(workspaceRoot, '.docs-capture'), { recursive: true, force: true, maxRetries: 10 });
if (failed.length) {
  console.error(`\n${failed.length} scenario(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
