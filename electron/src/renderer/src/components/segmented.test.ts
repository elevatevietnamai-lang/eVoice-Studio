import { expect, it } from 'vitest';
import { chipTrayClass, segmentedFrameClass } from './segmented';
import tabsSource from './ui/tabs.tsx?raw';
import toggleGroupSource from './ui/toggle-group.tsx?raw';

// Tailwind steps in px for the classes these frames use.
const RADIUS: Record<string, number> = { sm: 4, lg: 8, '(--card-radius)': 12 };
const PADDING: Record<string, number> = { '0.5': 2, '1': 4, '1.5': 6, '2': 8 };

function nested(classes: string) {
  const outer = RADIUS[/(?:^| )rounded-(\S+)/.exec(classes)![1]];
  const inset = PADDING[/(?:^| )p-(\S+)/.exec(classes)![1]];
  const inner = RADIUS[/\[&>\*\]:rounded-(\S+)/.exec(classes)![1]];
  return { outer, inset, inner };
}

it('keeps nested corners concentric: inner radius = outer radius - inset', () => {
  for (const classes of [segmentedFrameClass, chipTrayClass]) {
    const { outer, inset, inner } = nested(classes);
    expect(inner, classes).toBe(outer - inset);
  }
});

it('gives TabsList, ToggleGroup and Button groups one frame: 12 px, 4 px inset, 8 px items', () => {
  expect(nested(segmentedFrameClass)).toEqual({ outer: 12, inset: 4, inner: 8 });
  expect(tabsSource).toMatch(/justify-center rounded-\(--card-radius\) p-1 /);
  expect(toggleGroupSource).toMatch(/gap-1 rounded-\(--card-radius\) bg-muted p-1 /);
  for (const source of [tabsSource, toggleGroupSource]) expect(source).not.toMatch(/rounded-sm/);
});

const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx', '!./ui/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

it('never hand-builds a segmented frame: groups use segmentedFrameClass', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  const hits = Object.entries(sources)
    .filter(([, source]) => /rounded-(?:lg|sm)[^'"`]*bg-muted p-1/.test(source))
    .map(([file]) => file);
  expect(hits).toEqual([]);
});
