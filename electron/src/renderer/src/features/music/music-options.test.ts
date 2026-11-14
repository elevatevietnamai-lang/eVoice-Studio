import { expect, it } from 'vitest';
import {
  appendStyleTag,
  changedLmValues,
  defaultLmValues,
  extendedLength,
  insertLyricTag,
  knownKey,
  MAX_SEED,
  randomSeed,
  settingsFromTrack,
  type MusicSettings,
} from './music-options';
import { applyFormat } from './music-format-dialog';

it('adds a style tag once, comma separated', () => {
  expect(appendStyleTag('', 'piano')).toBe('piano');
  expect(appendStyleTag('calm lo-fi, soft', 'piano')).toBe('calm lo-fi, soft, piano');
  expect(appendStyleTag('calm, Piano', 'piano')).toBe('calm, Piano');
});

it('puts a lyric tag on its own line, one blank line after the previous section', () => {
  expect(insertLyricTag('', 0, 'verse')).toEqual({ text: '[verse]\n', cursor: 8 });
  expect(insertLyricTag('la la', 5, 'chorus')).toEqual({
    text: 'la la\n\n[chorus]\n',
    cursor: 16,
  });
  expect(insertLyricTag('la\n', 3, 'bridge').text).toBe('la\n\n[bridge]\n');
  expect(insertLyricTag('la\n\nend', 4, 'outro').text).toBe('la\n\n[outro]\nend');
});

const current: MusicSettings = {
  prompt: 'x',
  lyrics: '',
  instrumental: true,
  duration: 60,
  bpm: '',
  vocalLanguage: 'vi',
  keyScale: '',
  timeSignature: '',
  seed: '',
  thinking: false,
  batchSize: '3',
  steps: 8,
  inferMethod: 'ode',
  audioFormat: 'wav',
  model: 'turbo',
};

it('reuses every setting a track was saved with, one variant at a time', () => {
  const next = settingsFromTrack(
    {
      prompt: 'warm jazz',
      lyrics: '[verse]\nhi',
      instrumental: false,
      duration: 95,
      bpm: 92,
      seed: 7,
      vocal_language: 'en',
      key_scale: 'D minor',
      time_signature: '3',
      thinking: true,
      inference_steps: 6,
      infer_method: 'sde',
      ext: 'flac',
    },
    current,
  );
  expect(next).toEqual({
    prompt: 'warm jazz',
    lyrics: '[verse]\nhi',
    instrumental: false,
    duration: 95,
    bpm: '92',
    vocalLanguage: 'en',
    keyScale: 'D minor',
    timeSignature: '3',
    seed: '7',
    thinking: true,
    batchSize: '1',
    steps: 6,
    inferMethod: 'sde',
    audioFormat: 'flac',
    model: 'turbo',
  });
});

it('fills defaults for tracks saved before the newer settings existed', () => {
  const next = settingsFromTrack(
    { prompt: 'old', lyrics: '', instrumental: true, duration: 30, bpm: null },
    current,
  );
  expect(next).toMatchObject({
    vocalLanguage: 'vi',
    seed: '',
    steps: 8,
    inferMethod: 'ode',
    audioFormat: 'wav',
    batchSize: '1',
  });
});

it("drops a key or meter the server reported as 'N/A' (tracks saved by 0.5.7-beta.3)", () => {
  const next = settingsFromTrack(
    {
      prompt: 'x',
      lyrics: '',
      instrumental: true,
      duration: 30,
      bpm: null,
      key_scale: 'N/A',
      time_signature: 'N/A',
    },
    current,
  );
  expect(next).toMatchObject({ keyScale: '', timeSignature: '' });
  expect(knownKey('F# minor')).toBe('F# minor');
});

it('draws random seeds from the whole range ACE-Step uses', () => {
  expect(MAX_SEED).toBe(4294967295);
  for (let i = 0; i < 50; i += 1) {
    const seed = randomSeed();
    expect(Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED).toBe(true);
  }
});

it('applies only what the language model filled in', () => {
  const fields = {
    prompt: 'lofi',
    lyrics: 'la',
    bpm: '80',
    keyScale: '',
    timeSignature: '',
    duration: 60,
    vocalLanguage: 'vi',
  };
  const suggestion = {
    caption: 'warm lofi, vinyl crackle',
    lyrics: '[verse]\nla',
    bpm: null,
    key_scale: 'A minor',
    time_signature: '',
    duration: null,
    vocal_language: 'unknown',
  };
  expect(applyFormat(fields, suggestion, false)).toEqual({
    ...fields,
    prompt: 'warm lofi, vinyl crackle',
    lyrics: '[verse]\nla',
    keyScale: 'A minor',
  });
  // An instrumental keeps its (unused) lyrics and language.
  expect(applyFormat(fields, suggestion, true).lyrics).toBe('la');
});

it('keeps steps that fit the model and resets the rest to its default', () => {
  expect(
    settingsFromTrack(
      {
        prompt: 'x',
        lyrics: '',
        instrumental: true,
        duration: 30,
        bpm: null,
        model: 'sft',
        inference_steps: 48,
      },
      current,
    ),
  ).toMatchObject({ model: 'sft', steps: 48 });
  expect(
    settingsFromTrack(
      {
        prompt: 'x',
        lyrics: '',
        instrumental: true,
        duration: 30,
        bpm: null,
        model: 'base',
        inference_steps: 4,
      },
      current,
    ),
  ).toMatchObject({ model: 'base', steps: 32 });
  expect(
    settingsFromTrack(
      {
        prompt: 'x',
        lyrics: '',
        instrumental: true,
        duration: 30,
        bpm: null,
        model: 'xl',
        inference_steps: 40,
      },
      current,
    ),
  ).toMatchObject({ model: 'turbo', steps: 8 });
});

it('sends only the language model options moved off the server defaults', () => {
  const values = defaultLmValues();
  expect(changedLmValues(values, '')).toEqual({});
  expect(changedLmValues(values, ' NO USER INPUT ')).toEqual({});
  expect(changedLmValues({ ...values, lm_temperature: 1.1, lm_top_k: 40 }, 'no drums')).toEqual({
    lm_temperature: 1.1,
    lm_top_k: 40,
    lm_negative_prompt: 'no drums',
  });
});

it('shows the extended length up to the engine limit', () => {
  expect(extendedLength(40.4, 20)).toBe(60);
  expect(extendedLength(590, 120)).toBe(600);
});
