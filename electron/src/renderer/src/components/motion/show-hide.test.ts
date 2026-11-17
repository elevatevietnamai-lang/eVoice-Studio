import { expect, it } from 'vitest';

const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(path: string, encoding: 'utf8'): string;
        readdirSync(path: string, options: { recursive: true }): string[];
      };
    };
  }
).process.getBuiltinModule('node:fs');

const root = 'src/renderer/src';
const sources = fs
  .readdirSync(root, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
  .map((file) => ({ file, text: fs.readFileSync(`${root}/${file}`, 'utf8') }));

/**
 * Tailwind v4's scale-*, translate-* and rotate-* utilities set the `scale`, `translate` and
 * `rotate` properties, not `transform`. A `transition-[opacity,transform]` therefore faded an
 * overlay but snapped its 97% scale (DESIGN.md: overlays fade and scale in).
 */
it('transitions the property each motion utility actually sets', () => {
  const offenders: string[] = [];
  for (const { file, text } of sources) {
    for (const [cls] of text.matchAll(
      /["'`][^"'`]*(?:starting-style|ending-style|popup-open|open)[^"'`]*["'`]/g,
    )) {
      const transition = cls.match(/transition-\[([^\]]+)\]/)?.[1];
      if (!transition) continue;
      for (const property of ['scale', 'translate', 'rotate']) {
        if (
          // Only a value a state variant changes (`data-starting-style:scale-…`) is animated;
          // a static `-translate-x-1/2` that centres a dialog is not.
          new RegExp(`:-?${property}-`).test(cls) &&
          !transition.split(',').includes(property)
        )
          offenders.push(`${file}: ${property} not in transition-[${transition}]`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

/**
 * Blocks whose state is not a boolean move the same way, since a choice, a typed value or a picked
 * row shows them just as a switch does: Music task options (`musicTask === 'cover'`), inline
 * confirmations (`confirmation === row.id`), the dub bulk-selection bar and segment options.
 * Only boolean states were checked, so all of these popped in.
 */
const settledElsewhere = new Set([
  // The whole step settles in through FadeIn on the keyed <main>; each step is one branch of it.
  'components/setup-gate.tsx step',
  // An inline field in the split toolbar row: a height reveal would shift the row's controls.
  'features/longform/story-editor.tsx splitMode',
]);

/** A block a person shows with a button, switch, choice or input opens through `<Reveal>`. */
it('reveals user-toggled blocks instead of popping them in', () => {
  const block =
    '(div|section|form|p|ul|ol|fieldset|Collapsible|Row|Card|Alert|label|details|table|SettingsRow)';
  const offenders: string[] = [];
  for (const { file, text } of sources) {
    if (!file.endsWith('.tsx') || file.startsWith('components/ui/')) continue;
    const states = [...text.matchAll(/const \[(\w+),\s*(set\w+)\]\s*=\s*useState\b/g)];
    for (const [, state, setter] of states) {
      const userDriven = new RegExp(
        `on(Click|CheckedChange|OpenChange|PressedChange|ValueChange|Toggle)=\\{[^}]*${setter}|${setter}\\(\\(?\\w*\\)? =>`,
      ).test(text);
      if (!userDriven) continue;
      const pattern = new RegExp(
        `\\{\\s*!?${state}\\b[^{}\\n]{0,40}?&&\\s*\\(\\s*<${block}\\b`,
        'g',
      );
      for (const match of text.matchAll(pattern)) {
        const before = text.slice(Math.max(0, match.index - 160), match.index);
        if (
          !/<(Reveal|AnimatePresence|Swap)\b[^>]*>\s*$/.test(before) &&
          !settledElsewhere.has(`${file} ${state}`)
        )
          offenders.push(`${file}:${text.slice(0, match.index).split('\n').length} ${state}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
