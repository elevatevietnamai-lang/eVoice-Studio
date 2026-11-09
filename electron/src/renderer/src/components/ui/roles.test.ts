import { expect, it } from 'vitest';
import { componentRoles, motionKit } from './roles';

const files = import.meta.glob('./*.tsx');
const names = Object.keys(files)
  .map((path) => path.replace('./', '').replace('.tsx', ''))
  .filter((name) => !name.endsWith('.test'));

// vitest stubs `.css` only, so a Markdown file can be read through Node; cwd is `electron/`.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
    };
  }
).process;
const designDoc = nodeProcess.getBuiltinModule('node:fs').readFileSync('../DESIGN.md', 'utf8');

it('declares a role for every primitive in components/ui', () => {
  expect(names.length).toBeGreaterThan(20);
  expect(names.filter((name) => !(name in componentRoles))).toEqual([]);
  expect(Object.keys(componentRoles).filter((name) => !names.includes(name))).toEqual([]);
});

it('gives every role a use, tokens and a motion note', () => {
  for (const [name, spec] of Object.entries(componentRoles)) {
    expect(spec.use.length, name).toBeGreaterThan(10);
    expect(spec.tokens.length, name).toBeGreaterThan(0);
    expect(spec.motionNote.length, name).toBeGreaterThan(3);
    for (const token of spec.tokens) {
      expect(token === 'currentColor' || token.startsWith('--'), `${name} ${token}`).toBe(true);
    }
  }
});

it('allows loops only for activity indicators', () => {
  const loops = Object.entries(componentRoles)
    .filter(([, spec]) => spec.motion === 'loop')
    .map(([name]) => name);
  expect(loops.sort()).toEqual(['skeleton', 'spinner']);
  expect(Object.keys(motionKit)).toContain('MotionProvider');
});

it('lists every primitive in the DESIGN.md component table', () => {
  for (const name of Object.keys(componentRoles)) {
    expect(designDoc, name).toContain('`' + name + '`');
  }
});
