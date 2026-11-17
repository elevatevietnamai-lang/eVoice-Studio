import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(path: string, encoding: 'utf8'): string;
        readdirSync(path: string): string[];
      };
    };
  }
).process.getBuiltinModule('node:fs');

const dir = 'src/renderer/src/components/ui';
const primitives = fs
  .readdirSync(dir)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file, text: fs.readFileSync(`${dir}/${file}`, 'utf8') }));

/** Properties each `transition-*` shorthand animates (Tailwind v4). */
const shorthand: Record<string, string[]> = {
  'transition-colors': ['color', 'background-color', 'border-color'],
  'transition-opacity': ['opacity'],
  'transition-shadow': ['box-shadow'],
  'transition-transform': ['transform', 'translate', 'scale', 'rotate'],
};

function animated(cls: string): string[] | 'all' | null {
  const arbitrary = cls.match(/(?:^|\s)transition-\[([^\]]+)\]/)?.[1];
  if (arbitrary) return arbitrary.split(',');
  const named = cls.match(/(?:^|\s)(transition-(?:colors|opacity|shadow|transform|all))(?=\s|$)/)?.[1];
  if (named === 'transition-all') return 'all';
  if (named) return shorthand[named];
  return /(?:^|\s)transition(?=\s|$)/.test(cls) ? 'all' : null;
}

/**
 * DESIGN.md: the focus ring appears with the colour transition on every primitive. Toggle,
 * ToggleGroup and Tabs used `transition-colors`, which leaves `box-shadow` out, so their ring
 * snapped on while Button, Input and Select faded it in.
 */
it('fades the focus ring in on every primitive that draws one', () => {
  const offenders: string[] = [];
  for (const { file, text } of primitives) {
    // The base string of each primitive: the one that sets the ring width (`ring-[3px]`, `ring-2`).
    for (const [, cls] of text.matchAll(/"([^"\n]*focus-visible:ring-(?:\[|\d)[^"\n]*)"/g)) {
      const props = animated(cls);
      if (props !== 'all' && !props?.includes('box-shadow'))
        offenders.push(`${file}: ${props ? props.join(',') : 'no transition'}`);
    }
  }
  expect(offenders).toEqual([]);
});

/** The Switch thumb slides and, in dark mode, changes colour; both run together with the track. */
it('moves and recolours the switch thumb in one transition', () => {
  const thumb = fs
    .readFileSync(`${dir}/switch.tsx`, 'utf8')
    .match(/SwitchPrimitive\.Thumb[\s\S]*?className="([^"]+)"/)![1];
  const props = animated(thumb);
  expect(props).not.toBe('all');
  expect(props).toEqual(expect.arrayContaining(['translate', 'background-color']));
});
