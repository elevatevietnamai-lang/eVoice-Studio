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

/** Variants per run, turbo step range, samplers and file formats (backend `services/music.py`). */
export const BATCH_SIZES = ['1', '2', '3', '4'] as const;
export const MIN_STEPS = 4;
export const MAX_STEPS = 20;
export const DEFAULT_STEPS = 8;
export const INFER_METHODS = ['ode', 'sde'] as const;
export const AUDIO_FORMATS = ['wav', 'flac', 'mp3'] as const;
export type InferMethod = (typeof INFER_METHODS)[number];
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/**
 * Song-structure tags ACE-Step reads in lyrics (its own vocabulary, so they stay in English).
 * The toolbar inserts each one on a line of its own.
 */
export const LYRIC_TAGS = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'bridge',
  'outro',
  'instrumental',
] as const;

/**
 * Style words the music model understands, appended to the description with one click.
 * Model vocabulary in English, like the presets; only the group names are translated.
 */
export const STYLE_TAGS = {
  genre: [
    'pop',
    'rock',
    'hip hop',
    'r&b',
    'jazz',
    'lo-fi',
    'edm',
    'house',
    'ambient',
    'cinematic',
    'folk',
    'ballad',
  ],
  instrument: [
    'piano',
    'acoustic guitar',
    'electric guitar',
    'strings',
    'synth',
    'bass',
    'drums',
    'saxophone',
    'violin',
    'flute',
  ],
  mood: ['calm', 'upbeat', 'melancholic', 'epic', 'dreamy', 'energetic', 'romantic', 'dark'],
} as const;
export type StyleGroup = keyof typeof STYLE_TAGS;

/** The description with *tag* added at the end, once (case-insensitive). */
export function appendStyleTag(prompt: string, tag: string): string {
  const parts = prompt
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part.toLowerCase() === tag.toLowerCase())) return prompt;
  return [...parts, tag].join(', ');
}

/**
 * Insert `[tag]` on its own line at the cursor. Returns the new text and where the cursor goes
 * (just after the tag's line break, ready to type the section).
 */
export function insertLyricTag(
  text: string,
  cursor: number,
  tag: string,
): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  // Sections are separated by one blank line.
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const block = `${lead}[${tag}]\n`;
  return { text: before + block + after, cursor: before.length + block.length };
}

/** A saved track's settings, as the form holds them. */
export interface MusicSettings {
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number;
  bpm: string;
  vocalLanguage: string;
  keyScale: string;
  timeSignature: string;
  seed: string;
  thinking: boolean;
  batchSize: string;
  steps: number;
  inferMethod: InferMethod;
  audioFormat: AudioFormat;
}

export interface SavedTrackSettings {
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number;
  bpm: number | null;
  seed?: number | null;
  vocal_language?: string;
  key_scale?: string;
  time_signature?: string;
  thinking?: boolean;
  inference_steps?: number;
  infer_method?: string;
  ext?: string;
}

/**
 * Form settings that reproduce *track*. Fields older tracks lack keep the form's current value,
 * and a single variant is made (the seed identifies one variant, not the batch).
 */
export function settingsFromTrack(
  track: SavedTrackSettings,
  current: MusicSettings,
): MusicSettings {
  const steps = Number(track.inference_steps);
  return {
    ...current,
    prompt: track.prompt,
    lyrics: track.lyrics,
    instrumental: track.instrumental,
    duration: Math.max(10, Math.min(240, Math.round(track.duration || current.duration))),
    bpm: track.bpm ? String(track.bpm) : '',
    vocalLanguage: (VOCAL_LANGUAGES as readonly string[]).includes(track.vocal_language ?? '')
      ? (track.vocal_language as string)
      : current.vocalLanguage,
    keyScale: track.key_scale ?? '',
    timeSignature: (TIME_SIGNATURES as readonly string[]).includes(track.time_signature ?? '')
      ? (track.time_signature as string)
      : '',
    seed: typeof track.seed === 'number' ? String(track.seed) : '',
    thinking: Boolean(track.thinking),
    batchSize: '1',
    steps:
      Number.isInteger(steps) && steps >= MIN_STEPS && steps <= MAX_STEPS ? steps : DEFAULT_STEPS,
    inferMethod: track.infer_method === 'sde' ? 'sde' : 'ode',
    audioFormat: (AUDIO_FORMATS as readonly string[]).includes(track.ext ?? '')
      ? (track.ext as AudioFormat)
      : 'wav',
  };
}
