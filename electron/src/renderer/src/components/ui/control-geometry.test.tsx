import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Shared JSX has no declaration file.
import SearchableSelect from '@shared/components/SearchableSelect';
import { buttonVariants } from './button';

// One stable object: a fresh `t` or `i18n` per render re-runs the picker's effects forever.
const i18n = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'en', dir: () => 'ltr' },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));

afterEach(cleanup);

/** The field every control shares (DESIGN.md: Input, Select, Textarea and Button). */
const FIELD = ['rounded-(--control-radius)', 'border-input', 'bg-control-fill'];
const options = [{ value: 'en', label: 'English', search: ['english'] }];

describe('control geometry', () => {
  it('keeps every Button size at the control radius', () => {
    for (const size of ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const) {
      expect(buttonVariants({ size })).not.toMatch(/\brounded-(?:sm|xs|md)\b/);
    }
  });

  it('draws the searchable picker as the Select field, 32 px or 24 px', () => {
    render(
      <>
        <SearchableSelect virtualized value="en" options={options} onChange={() => {}} ariaLabel="big" />
        <SearchableSelect
          virtualized
          size="sm"
          value="en"
          options={options}
          onChange={() => {}}
          ariaLabel="small"
        />
      </>,
    );
    const big = screen.getByRole('button', { name: 'big' });
    const small = screen.getByRole('button', { name: 'small' });
    for (const token of [...FIELD, 'data-[size=default]:h-8', 'data-[size=sm]:h-6']) {
      expect(big.className).toContain(token);
    }
    expect(big).toHaveAttribute('data-size', 'default');
    expect(small).toHaveAttribute('data-size', 'sm');
    expect(big.className).not.toMatch(/\bh-9\b|\brounded-lg\b/);
  });

  it('gives the classic picker the same field and lets callers override it', () => {
    render(
      <>
        <SearchableSelect value="en" options={options} onChange={() => {}} ariaLabel="plain" />
        <SearchableSelect
          value="en"
          options={options}
          onChange={() => {}}
          ariaLabel="wide"
          buttonClassName="h-8 min-w-64 text-sm"
        />
      </>,
    );
    const plain = screen.getByRole('button', { name: 'plain' });
    for (const token of [...FIELD, 'h-8', 'text-sm']) expect(plain.className).toContain(token);
    // Merged, not concatenated: the caller's text size replaces the default.
    expect(screen.getByRole('button', { name: 'wide' }).className).not.toContain('text-[0.75rem]');
  });
});
