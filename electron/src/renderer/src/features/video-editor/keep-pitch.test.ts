import { describe, expect, it } from 'vitest';
import { audioSegments, bufferKey, scheduleSegments } from './audio-mix';
import { emptyProject, parseProject, serializeProject, type EditorMedia, type EditorProject } from './project';
import { insertMedia, setKeepPitch, setSpeed } from './timeline-ops';

const voice: EditorMedia = {
  id: 'v',
  kind: 'audio',
  name: 'voice.wav',
  url: '/promo/media/v',
  duration: 8,
  width: null,
  height: null,
  has_audio: true,
};

function sped(rate: number): { project: EditorProject; ref: { trackId: string; elementId: string } } {
  const placed = insertMedia(emptyProject(), voice, 0);
  return { project: setSpeed(placed.project, placed.ref, rate), ref: placed.ref };
}

/** Records what the schedule asks of each source node. */
function fakeContext() {
  const started: { rate: number; offset: number; duration: number; buffer: unknown }[] = [];
  const context = {
    createBufferSource() {
      const node = {
        buffer: null as unknown,
        playbackRate: { value: 1 },
        connect: () => ({ connect: () => undefined }),
        start: (_when: number, offset: number, duration: number) =>
          started.push({ rate: node.playbackRate.value, offset, duration, buffer: node.buffer }),
      };
      return node;
    },
    createGain: () => ({ gain: { setValueCurveAtTime: () => undefined }, connect: () => undefined }),
    destination: {},
  };
  return { context: context as unknown as BaseAudioContext, started };
}

describe('keep pitch', () => {
  it('is on for a clip given a speed for the first time', () => {
    const { project } = sped(2);
    const [segment] = audioSegments(project);
    expect(segment).toMatchObject({ rate: 2, keepPitch: true });
    expect(bufferKey(segment)).toBe('v@2');
  });

  it('leaves a clip from before Keep pitch as it sounded', () => {
    const { project, ref } = sped(2);
    const old = setKeepPitch(project, ref, false);
    // Saved and loaded again, it still plays the file sped up (pitch shifted).
    const loaded = parseProject(serializeProject(old))!;
    const [segment] = audioSegments(loaded);
    expect(segment).toMatchObject({ rate: 2, keepPitch: false });
    expect(bufferKey(segment)).toBe('v');
    // Changing its speed again keeps its setting.
    const [again] = audioSegments(setSpeed(loaded, ref, 1.5));
    expect(again.keepPitch).toBe(false);
  });

  it('plays the stretched copy at normal rate, from the matching point', () => {
    const { project } = sped(2);
    const [segment] = audioSegments(project);
    const stretched = { duration: 4 } as AudioBuffer;
    const { context, started } = fakeContext();
    scheduleSegments(context, [segment], new Map([[bufferKey(segment), stretched]]), 1, 0);
    // One second into the clip is two seconds into the file, one second into the stretched copy.
    expect(started).toEqual([{ rate: 1, offset: 1, duration: 3, buffer: stretched }]);
  });

  it('plays the file itself faster when Keep pitch is off', () => {
    const { project, ref } = sped(2);
    const [segment] = audioSegments(setKeepPitch(project, ref, false));
    const file = { duration: 8 } as AudioBuffer;
    const { context, started } = fakeContext();
    scheduleSegments(context, [segment], new Map([['v', file]]), 1, 0);
    expect(started).toEqual([{ rate: 2, offset: 2, duration: 6, buffer: file }]);
  });
});
