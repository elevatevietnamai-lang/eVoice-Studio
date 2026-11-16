import { expect, it } from 'vitest';

// vitest stubs `.css` imports, so read the sources through Node. cwd is `electron/`.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');
const dir = 'src/renderer/src/components/app-shell/';
const files = [
  'workspace-menu.tsx',
  'workspace-menu.css',
  'workspace-sidebar.tsx',
  'workspace-header.tsx',
  'context-sidebar.tsx',
  'status-bar.tsx',
];

const hue =
  /\b(?:bg|text|ring|border|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate)-\d/;

it('keeps the menu, sidebar, header and status bar flat and token-driven', () => {
  for (const file of files) {
    const source = fs.readFileSync(dir + file, 'utf8');
    expect(source, file).not.toMatch(hue);
    expect(source, file).not.toMatch(/gradient|backdrop-blur|backdrop-filter|drop-shadow|rgb\(/);
    expect(source, file).not.toMatch(/--color-(?:red|blue|green|pink|violet|fuchsia|amber)-/);
    expect(source, file).not.toMatch(/data-(?:tone|motion)/);
  }
});

it('keeps menu labels in sentence case and never caps the menu height', () => {
  const menu = fs.readFileSync(dir + 'workspace-menu.tsx', 'utf8');
  // All-caps and letter spacing break Vietnamese diacritics (DESIGN.md section 3).
  expect(menu).not.toMatch(/uppercase|tracking-/);
  // The rail's middle row centres and scrolls on its own; a cap on the nav hid its icons.
  const globals = fs.readFileSync('src/renderer/src/styles/globals.css', 'utf8');
  expect(globals).not.toMatch(/workspace-navigation'\]\s*\{[^}]*max-height/);
});
