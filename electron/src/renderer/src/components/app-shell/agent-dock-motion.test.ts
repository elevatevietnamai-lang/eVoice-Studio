import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');

const dir = 'src/renderer/src/components/app-shell';
const agent = fs.readFileSync(`${dir}/voice-studio-agent.tsx`, 'utf8');
const css = fs.readFileSync(`${dir}/voice-studio-agent.css`, 'utf8');

/** The dock and its launcher used to replace each other in one frame. */
it('opens the dock by height and lets the launcher scale in and out', () => {
  expect(agent).toMatch(/<Reveal className="shrink-0">\s*\{view === 'agent' \? dock/);
  expect(agent).toMatch(/<AnimatePresence>\s*\{view === 'launcher' && \(\s*<AgentLauncher/);
  // No early return may bypass the presence wrappers.
  expect(agent).not.toMatch(/if \(!open[^)]*\)\s*return/);
});

/** Chat messages are cards: every corner takes the card radius, with no speech-bubble corner. */
it('rounds every corner of a chat message alike', () => {
  const radii = [...css.matchAll(/\.agent-workspace-message[^{]*\{[^}]*border-radius:\s*([^;]+);/g)].map(
    ([, value]) => value.trim(),
  );
  expect(radii).toEqual(['var(--card-radius)']);
});
