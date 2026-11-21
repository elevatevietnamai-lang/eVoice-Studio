import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// DESIGN.md: a job's progress lives in the button that started it. These pages have no install
// or download bar of their own, so a visible Progress bar here would sit under a start button.
const PAGES = [
  'clone/action-bar.tsx',
  'design/design-page.tsx',
  'dub/bgm-panel.tsx',
  'longform/generate-panel.tsx',
  'longform/generation-progress.tsx',
  'video-editor/editor-page.tsx',
  'video-editor/animated-title.tsx',
];

it.each(PAGES)('%s shows job progress in its button, not as a bar', (page) => {
  const source = readFileSync(join(__dirname, page), 'utf8');
  expect(source).not.toMatch(/from '@\/components\/ui\/progress'/);
  expect(source).not.toMatch(/@base-ui\/react\/progress/);
  expect(source).not.toMatch(/style=\{\{ width: `\$\{/);
});

it.each([
  ['music/music-page.tsx', "label={t('musicStudio.generating')}"],
  ['dub/hardsub-panel.tsx', "label={t('dub_hardsub.read')}"],
  ['dub/hardsub-panel.tsx', "label={t('dub_hardsub.remove')}"],
])('%s keeps the job bar for screen readers only', (page, label) => {
  const source = readFileSync(join(__dirname, page), 'utf8');
  expect(source).toContain(`<JobProgress value={task.progress * 100} ${label}`);
  expect(source).not.toContain(`aria-label=${label.slice('label='.length)}`);
});
