import { readFileSync } from 'node:fs';

const VI = JSON.parse(
  readFileSync(new URL('../../src/renderer/src/i18n/locales/vi.json', import.meta.url), 'utf8'),
);

/** The Vietnamese UI string for an i18n key, so a scenario breaks loudly when the UI text changes. */
export function vi(key) {
  const value = key.split('.').reduce((node, part) => node?.[part], VI);
  if (typeof value !== 'string') throw new Error(`vi.json has no string at "${key}"`);
  return value;
}
