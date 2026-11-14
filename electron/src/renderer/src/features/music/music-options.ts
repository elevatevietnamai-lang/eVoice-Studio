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

/** ACE-Step's seed range (it draws batch variants from all of it). */
export const MAX_SEED = 2 ** 32 - 1;

/** A random seed in the range the backend accepts. */
export function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1));
}

/** A key the form can hold ('C major', 'F# minor'), or '' for anything else (the server's 'N/A'). */
export function knownKey(value: string | undefined): string {
  return /^[A-G][#b]? (major|minor)$/.test(value ?? '') ? (value as string) : '';
}

/** Variants per run, turbo's default steps, samplers and file formats (backend `services/music.py`). */
export const BATCH_SIZES = ['1', '2', '3', '4'] as const;
export const DEFAULT_STEPS = 8;
export const INFER_METHODS = ['ode', 'sde'] as const;
export const AUDIO_FORMATS = ['wav', 'flac', 'mp3'] as const;
export type InferMethod = (typeof INFER_METHODS)[number];
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/**
 * DiT models: steps as [min, max, default] and whether guidance (CFG, shift, ADG, CFG interval)
 * applies. Mirrors `DIT_MODELS` in the backend; `test_renderer_model_table_matches_the_backend`
 * keeps the two equal.
 */
export const DIT_MODELS = {
  turbo: { steps: [4, 8, 8], guidance: false },
  sft: { steps: [8, 64, 32], guidance: true },
  base: { steps: [8, 64, 32], guidance: true },
} as const;
export type DitModel = keyof typeof DIT_MODELS;
export const DIT_MODEL_IDS = Object.keys(DIT_MODELS) as DitModel[];
export const GUIDANCE_RANGE = [1, 15, 7] as const;
export const SHIFT_RANGE = [1, 5, 3] as const;

/**
 * Instruments ACE-Step names for its stem tasks, in its own order (backend `TRACK_NAMES`).
 * Extract pulls one out of a song, Lego adds one, Complete finishes an arrangement with several.
 */
export const TRACK_NAMES = [
  'woodwinds',
  'brass',
  'fx',
  'synth',
  'strings',
  'percussion',
  'keyboard',
  'guitar',
  'bass',
  'drums',
  'backing_vocals',
  'vocals',
] as const;
export type TrackName = (typeof TRACK_NAMES)[number];
/** Tasks only the Base model runs (backend `BASE_TASKS`). */
export const BASE_TASKS = ['extract', 'lego', 'complete'] as const;

/** Extend: [min, max, default] seconds of new music, and of the source redone with it. */
export const EXTEND_SECONDS = [5, 120, 30] as const;
export const EXTEND_OVERLAP = [0, 10, 2] as const;
export const EXTEND_SIDES = ['end', 'start'] as const;
export type ExtendSide = (typeof EXTEND_SIDES)[number];
/** The longest source plus extension the engine accepts (backend `MAX_SOURCE_SECONDS`). */
export const MAX_SOURCE_SECONDS = 600;

/**
 * The language model's sampling options (Thinking only): range [min, max, server default] and the
 * slider step. `null` as the default means off. Mirrors `LM_PARAMS` in the backend.
 */
export const LM_PARAMS = {
  lm_temperature: { range: [0.1, 2, 0.85], step: 0.05 },
  lm_cfg_scale: { range: [1, 5, 2.5], step: 0.1 },
  lm_top_k: { range: [1, 200, null], step: 1 },
  lm_top_p: { range: [0.1, 1, 0.9], step: 0.05 },
  lm_repetition_penalty: { range: [1, 2, 1], step: 0.05 },
} as const;
export type LmParam = keyof typeof LM_PARAMS;
export const LM_PARAM_IDS = Object.keys(LM_PARAMS) as LmParam[];
export const LM_NEGATIVE_PROMPT_DEFAULT = 'NO USER INPUT';
export type LmValues = Record<LmParam, number | null>;

/** Every option at the server's default. */
export function defaultLmValues(): LmValues {
  return Object.fromEntries(LM_PARAM_IDS.map((id) => [id, LM_PARAMS[id].range[2]])) as LmValues;
}

/** Only the options moved off the server's default, so an untouched form sends nothing new. */
export function changedLmValues(
  values: LmValues,
  negative: string,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const id of LM_PARAM_IDS) {
    const value = values[id];
    if (value !== null && value !== LM_PARAMS[id].range[2]) out[id] = value;
  }
  const text = negative.trim();
  if (text && text !== LM_NEGATIVE_PROMPT_DEFAULT) out.lm_negative_prompt = text;
  return out;
}

/** The new song's length: the source plus the extension, at most the engine's limit. */
export function extendedLength(sourceSeconds: number, extendSeconds: number): number {
  return Math.min(MAX_SOURCE_SECONDS, Math.round(sourceSeconds + extendSeconds));
}

/** *steps* moved into *model*'s range: kept when it fits, else that model's default. */
export function stepsFor(model: DitModel, steps: number): number {
  const [low, high, fallback] = DIT_MODELS[model].steps;
  return Number.isInteger(steps) && steps >= low && steps <= high ? steps : fallback;
}

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
  model: DitModel;
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
  model?: string;
}

/**
 * Form settings that reproduce *track*. Fields older tracks lack keep the form's current value,
 * and a single variant is made (the seed identifies one variant, not the batch).
 */
export function settingsFromTrack(
  track: SavedTrackSettings,
  current: MusicSettings,
): MusicSettings {
  const model: DitModel = DIT_MODEL_IDS.includes(track.model as DitModel)
    ? (track.model as DitModel)
    : 'turbo';
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
    keyScale: knownKey(track.key_scale),
    timeSignature: (TIME_SIGNATURES as readonly string[]).includes(track.time_signature ?? '')
      ? (track.time_signature as string)
      : '',
    seed: typeof track.seed === 'number' ? String(track.seed) : '',
    thinking: Boolean(track.thinking),
    batchSize: '1',
    steps: stepsFor(model, Number(track.inference_steps)),
    inferMethod: track.infer_method === 'sde' ? 'sde' : 'ode',
    audioFormat: (AUDIO_FORMATS as readonly string[]).includes(track.ext ?? '')
      ? (track.ext as AudioFormat)
      : 'wav',
    model,
  };
}
