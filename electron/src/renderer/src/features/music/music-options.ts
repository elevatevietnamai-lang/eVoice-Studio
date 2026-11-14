/** Choices ACE-Step accepts for a music request (backend `services/music.py`, from acestep/constants.py). */

export const VOCAL_LANGUAGES = [
  'ar',
  'az',
  'bg',
  'bn',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'hr',
  'ht',
  'hu',
  'id',
  'is',
  'it',
  'ja',
  'ko',
  'la',
  'lt',
  'ms',
  'ne',
  'nl',
  'no',
  'pa',
  'pl',
  'pt',
  'ro',
  'ru',
  'sa',
  'sk',
  'sr',
  'sv',
  'sw',
  'ta',
  'te',
  'th',
  'tl',
  'tr',
  'uk',
  'ur',
  'vi',
  'yue',
  'zh',
] as const;

export const KEY_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const TIME_SIGNATURES = ['2', '3', '4', '6'] as const;

/** 4/4 style label for the meter ACE-Step names by its beat count (6 is compound 6/8). */
export function meterLabel(value: string): string {
  return value === '6' ? '6/8' : `${value}/4`;
}

/** The app language when ACE-Step can sing it, else English. */
export function defaultVocalLanguage(appLanguage: string): string {
  const base = appLanguage.toLowerCase().split('-')[0];
  return (VOCAL_LANGUAGES as readonly string[]).includes(base) ? base : 'en';
}

/** Vocal languages named in the UI language, sorted by that name. */
export function vocalLanguageOptions(uiLanguage: string): { value: string; label: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([uiLanguage, 'en'], { type: 'language' });
  } catch {
    names = null;
  }
  return VOCAL_LANGUAGES.map((code) => ({ value: code, label: names?.of(code) || code })).sort(
    (a, b) => a.label.localeCompare(b.label, uiLanguage),
  );
}

/** A random seed in the range the backend accepts. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
