import { expect, it } from 'vitest';
import { cn } from './utils';

it('treats the type-scale tokens as font sizes, not colours', () => {
  expect(cn('text-sm text-(--sidebar-muted-foreground)', 'text-label')).toBe(
    'text-(--sidebar-muted-foreground) text-label',
  );
  expect(cn('text-ui', 'text-caption')).toBe('text-caption');
  expect(cn('text-editor', 'text-foreground')).toBe('text-editor text-foreground');
});
