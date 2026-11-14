/**
 * Changes the speed of sound without changing its pitch, by WSOLA (waveform
 * similarity overlap-add): the output is built from short overlapping windows
 * of the source, each taken from where it best continues the previous one,
 * so the waveform stays smooth while time runs faster or slower. Written for
 * the editor (no GPL/LGPL code); the preview and the export both play the
 * stretched buffer.
 */

/** Window length in seconds; long enough for low voices, short enough to keep transients. */
const WINDOW_SECONDS = 0.04;
/** How far a window may move from its nominal place to line up with the last one. */
const SEEK_SECONDS = 0.012;
/** The search runs on every DECIMATE-th sample first, then refines around the best match. */
const DECIMATE = 4;

function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

/** Cross-correlation of `a` from `aStart` and `b` from `bStart` over `length` samples, every `step`. */
function correlation(a: Float32Array, aStart: number, b: Float32Array, bStart: number, length: number, step: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += step) sum += a[aStart + i] * b[bStart + i];
  return sum;
}

export interface StretchPlan {
  /** Source sample where each output window starts. */
  positions: Int32Array;
  window: number;
  hop: number;
  length: number;
}

/**
 * Where each output window comes from, for `mono` played `rate` times as fast:
 * output windows are `hop` apart, source windows nominally `hop × rate` apart,
 * each nudged within the seek range to match the natural continuation of the
 * previous window.
 */
export function planStretch(mono: Float32Array, rate: number, sampleRate: number): StretchPlan {
  const window = Math.max(64, Math.round((WINDOW_SECONDS * sampleRate) / 2) * 2);
  const hop = window / 2;
  const seek = Math.round(SEEK_SECONDS * sampleRate);
  const length = Math.max(0, Math.round(mono.length / rate));
  const count = Math.max(1, Math.ceil(length / hop) + 1);
  const positions = new Int32Array(count);
  const last = Math.max(0, mono.length - window);
  let previous = 0;
  for (let k = 1; k < count; k++) {
    const nominal = Math.round(k * hop * rate);
    // What would follow the previous window if time ran at normal speed.
    const natural = previous + hop;
    if (natural + window > mono.length || nominal > last) {
      positions[k] = Math.min(last, Math.max(0, nominal));
      previous = positions[k];
      continue;
    }
    const from = Math.max(0, nominal - seek);
    const to = Math.min(last, nominal + seek);
    let best = Math.min(last, Math.max(0, nominal));
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let candidate = from; candidate <= to; candidate += DECIMATE) {
      const score = correlation(mono, candidate, mono, natural, window, DECIMATE);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    for (let candidate = Math.max(from, best - DECIMATE + 1); candidate <= Math.min(to, best + DECIMATE - 1); candidate++) {
      const score = correlation(mono, candidate, mono, natural, window, 1);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    positions[k] = best;
    previous = best;
  }
  return { positions, window, hop, length };
}

/** Overlap-adds the planned windows of one channel. */
export function renderStretch(channel: Float32Array, plan: StretchPlan): Float32Array {
  const { positions, window, hop, length } = plan;
  const out = new Float32Array(length);
  const weight = new Float32Array(length);
  const shape = hann(window);
  for (let k = 0; k < positions.length; k++) {
    const start = k * hop;
    const source = positions[k];
    for (let i = 0; i < window; i++) {
      const at = start + i;
      if (at < 0 || at >= length) continue;
      const sample = channel[source + i] ?? 0;
      out[at] += sample * shape[i];
      weight[at] += shape[i];
    }
  }
  for (let i = 0; i < length; i++) if (weight[i] > 1e-3) out[i] /= weight[i];
  return out;
}

/** Channels played `rate` times as fast at the same pitch. */
export function stretchChannels(channels: Float32Array[], rate: number, sampleRate: number): Float32Array[] {
  if (!channels.length) return [];
  if (rate === 1) return channels.map((channel) => channel.slice());
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  const plan = planStretch(mono, rate, sampleRate);
  return channels.map((channel) => renderStretch(channel, plan));
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Seconds of source stretched between yields, so a long file never freezes the page. */
const CHUNK_SECONDS = 20;

/**
 * An AudioBuffer of `buffer` played `rate` times as fast at the same pitch.
 * Long files are stretched in chunks (with a window of overlap so the seams
 * line up), yielding to the page between chunks.
 */
export async function stretchAudioBuffer(
  buffer: AudioBuffer,
  rate: number,
  create: (channels: number, length: number, sampleRate: number) => AudioBuffer,
): Promise<AudioBuffer> {
  const { sampleRate, numberOfChannels } = buffer;
  const source = Array.from({ length: numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const chunk = Math.round(CHUNK_SECONDS * sampleRate);
  const total = Math.max(1, Math.round(buffer.length / rate));
  const out = create(numberOfChannels, total, sampleRate);
  const targets = Array.from({ length: numberOfChannels }, (_, index) => out.getChannelData(index));
  const fade = Math.round(WINDOW_SECONDS * sampleRate);
  for (let start = 0; start < buffer.length; start += chunk) {
    // Each chunk carries a little extra on both sides; the overlap is crossfaded.
    const from = Math.max(0, start - fade);
    const to = Math.min(buffer.length, start + chunk + fade);
    const stretched = stretchChannels(
      source.map((channel) => channel.subarray(from, to)),
      rate,
      sampleRate,
    );
    const outStart = Math.round(from / rate);
    const lead = Math.round((start - from) / rate);
    for (let c = 0; c < numberOfChannels; c++) {
      const piece = stretched[c];
      const target = targets[c];
      for (let i = 0; i < piece.length; i++) {
        const at = outStart + i;
        if (at >= total) break;
        if (i < lead * 2 && start > 0) {
          // Crossfade the overlap with what the previous chunk wrote.
          const mix = lead > 0 ? Math.min(1, i / (lead * 2)) : 1;
          target[at] = target[at] * (1 - mix) + piece[i] * mix;
        } else target[at] = piece[i];
      }
    }
    await yieldToUi();
  }
  return out;
}
