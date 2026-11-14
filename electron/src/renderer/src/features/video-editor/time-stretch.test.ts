import { describe, expect, it } from 'vitest';
import { planStretch, stretchAudioBuffer, stretchChannels } from './time-stretch';

const SAMPLE_RATE = 48_000;

function sine(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  return out;
}

/** Frequency from upward zero crossings, away from the edges. */
function frequencyOf(samples: Float32Array): number {
  const from = Math.floor(samples.length * 0.1);
  const to = Math.floor(samples.length * 0.9);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings / ((to - from) / SAMPLE_RATE);
}

function rms(samples: Float32Array): number {
  const from = Math.floor(samples.length * 0.1);
  const to = Math.floor(samples.length * 0.9);
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

describe('time stretch (WSOLA)', () => {
  it.each([0.5, 0.75, 1.5, 2, 4])('plays %s× as fast at the same pitch and level', (rate) => {
    const source = sine(440, 1);
    const [out] = stretchChannels([source], rate, SAMPLE_RATE);
    expect(out.length).toBe(Math.round(source.length / rate));
    expect(frequencyOf(out)).toBeGreaterThan(430);
    expect(frequencyOf(out)).toBeLessThan(450);
    expect(rms(out)).toBeGreaterThan(0.3);
    expect(rms(out)).toBeLessThan(0.4);
  });

  it('keeps the channels aligned with each other', () => {
    const left = sine(300, 0.5);
    const right = left.map((value) => -value);
    const [l, r] = stretchChannels([left, right], 2, SAMPLE_RATE);
    for (let i = 0; i < l.length; i += 97) expect(l[i]).toBeCloseTo(-r[i], 5);
  });

  it('copies the sound at normal speed', () => {
    const source = sine(200, 0.2);
    expect(stretchChannels([source], 1, SAMPLE_RATE)[0]).toEqual(source);
  });

  it('takes each window near its nominal place in the source', () => {
    const plan = planStretch(sine(220, 1), 2, SAMPLE_RATE);
    plan.positions.forEach((position, k) => {
      const nominal = Math.min(SAMPLE_RATE - plan.window, k * plan.hop * 2);
      expect(Math.abs(position - nominal)).toBeLessThanOrEqual(Math.round(0.012 * SAMPLE_RATE) + 1);
    });
  });

  it('stretches a long buffer in chunks without a seam', async () => {
    const seconds = 45;
    const source = sine(330, seconds);
    const buffer = {
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      length: source.length,
      duration: seconds,
      getChannelData: () => source,
    } as unknown as AudioBuffer;
    const create = (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate, numberOfChannels: channels, length, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
    };
    const out = await stretchAudioBuffer(buffer, 1.5, create);
    const samples = out.getChannelData(0);
    expect(out.length).toBe(Math.round(source.length / 1.5));
    // Around the chunk boundary (20 s of source) the tone carries on at the same level.
    const seam = Math.round((20 / 1.5) * SAMPLE_RATE);
    const around = samples.subarray(seam - SAMPLE_RATE / 4, seam + SAMPLE_RATE / 4);
    expect(frequencyOf(around)).toBeGreaterThan(320);
    expect(frequencyOf(around)).toBeLessThan(340);
    expect(rms(around)).toBeGreaterThan(0.3);
  });
});
