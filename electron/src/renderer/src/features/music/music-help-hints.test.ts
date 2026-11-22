import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');
const root = 'src/renderer/src/features/music';

// DESIGN.md: an explanation sits behind the "?" beside its title, never as a paragraph under the
// control. Status lines, errors and what the user agrees to (the engine's download size) stay
// visible, so only these keys are checked.
const FILES = ['music-page.tsx', 'music-lora.tsx', 'music-source-picker.tsx'];
const EXPLANATION = /musicStudio\.(?!engine_help)[a-z0-9_${}]*(_help|_hint|credit)\b/;

it.each(FILES)('%s keeps its explanations behind a ?', (file) => {
  const source = fs.readFileSync(`${root}/${file}`, 'utf8');
  // A <p> (or any element) whose text is an explanation key.
  const paragraphs = source.match(/<p\b[^>]*>\s*\{t\([^)]*\)\}\s*<\/p>/g) ?? [];
  for (const paragraph of paragraphs) expect(paragraph).not.toMatch(EXPLANATION);
  expect(source).not.toMatch(/\{hint && <p/);
});

it('names the credit beside the Music Studio title', () => {
  const source = fs.readFileSync(`${root}/music-page.tsx`, 'utf8');
  expect(source).toMatch(/titleAction=\{\s*<HelpHint[^>]*>\{t\('musicStudio\.credit'\)\}/);
});
