import { expect, it } from 'vitest';
import { chipTrayClass, segmentedFrameClass } from './segmented';

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
