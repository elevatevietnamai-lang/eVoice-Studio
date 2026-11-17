import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import vi from '@/i18n/locales/vi.json';
import { ENGINE_UNAVAILABLE_CODES, engineAvailabilityText } from './engine-availability';

describe('engineAvailabilityText', () => {
  const t = (key: string) => `t:${key}`;

  it('renders the translated reason for a known code, never the English sentence', () => {
    expect(
      engineAvailabilityText(t, {
        availability_code: 'needs_config',
        availability_reason: 'This engine needs to be configured before it can run.',
      }),
    ).toBe('t:engines.unavailableReason_needs_config');
  });

  it('falls back to the backend sentence for an unknown code', () => {
    expect(
      engineAvailabilityText(t, { availability_code: 'new_code', availability_reason: 'English' }),
    ).toBe('English');
    expect(engineAvailabilityText(t, { availability_reason: null })).toBeUndefined();
  });

  it('has a translated sentence for every code', () => {
    for (const catalog of [en, vi]) {
      const engines = catalog.engines as unknown as Record<string, string>;
      for (const code of ENGINE_UNAVAILABLE_CODES)
        expect(engines[`unavailableReason_${code}`]).toBeTruthy();
    }
    expect(vi.engines.unavailableReason_unavailable).not.toBe(
      en.engines.unavailableReason_unavailable,
    );
  });
});
