import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// The web tsconfig has no Node types, so read sources through Node's builtin loader. cwd is `electron/`.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');
const css = fs.readFileSync('src/renderer/src/styles/globals.css', 'utf8');

afterEach(cleanup);

function openTooltip(content: React.ReactElement) {
  render(
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger render={<button type="button">Voice</button>} />
        {content}
      </Tooltip>
    </TooltipProvider>,
  );
  const popup = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
  if (!popup) throw new Error('tooltip did not open');
  return popup;
}

it('draws every tooltip as frosted glass by default, without an arrow', () => {
  const popup = openTooltip(<TooltipContent>Voice</TooltipContent>);
  expect(popup.dataset.surface).toBe('glass');
  expect(popup.className).toContain('surface-glass-tooltip');
  // The inverted chip is gone: a glass tooltip reads in the theme's own text colour.
  expect(popup.className).not.toContain('bg-foreground');
  expect(popup.className).not.toContain('text-background');
  expect(popup.querySelector('[class*="rotate-45"]')).toBeNull();
});

it('keeps the solid surfaces and their arrows when a caller asks for them', () => {
  const popup = openTooltip(<TooltipContent surface="theme">Credits</TooltipContent>);
  expect(popup.dataset.surface).toBe('theme');
  expect(popup.className).not.toContain('surface-glass-tooltip');
  expect(popup.querySelector('[class*="rotate-45"]')).not.toBeNull();
});

it('glass is frosted in every theme and falls back to a solid surface when transparency is reduced', () => {
  // Defined outside the [data-glass] palette rules, so the flat default theme gets it too.
  expect(css).toMatch(/@utility surface-glass-tooltip \{[\s\S]*?backdrop-filter: blur\(/);
  expect(css).toMatch(
    /prefers-reduced-transparency: reduce\) \{\s*\.surface-glass-tooltip \{[^}]*backdrop-filter: none/,
  );
  for (const token of ['fill', 'edge', 'sheen', 'shadow']) {
    expect(css.match(new RegExp(`--tooltip-glass-${token}:`, 'g'))?.length).toBe(2);
  }
});
