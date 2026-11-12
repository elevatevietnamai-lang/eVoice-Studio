import { describe, expect, it } from 'vitest';
import { DUCK_GAIN, audioSegments, dbToGain, duckCurve, gainAt, soundActivity, type AudioSegment } from './audio-mix';
import { emptyProject, type EditorMedia } from './project';
import { insertMedia, setParam, setTrackFlag } from './timeline-ops';

const segment = (patch: Partial<AudioSegment>): AudioSegment => ({
  mediaId: 'm',
  start: 0,
  duration: 10,
  offset: 0,
  rate: 1,
  volumeDb: 0,
  fadeIn: 0,
  fadeOut: 0,
  animations: undefined,
  duck: false,
  crossIn: 0,
  crossOut: 0,
  ...patch,
});

describe('mix', () => {
  it('collects clips with sound and leaves out muted ones', () => {
    const clip: EditorMedia = { id: 'v.mp4', kind: 'video', name: 'v', url: '/v', duration: 4, width: 1, height: 1, has_audio: true };
    const silent: EditorMedia = { ...clip, id: 's.mp4', has_audio: false };
    const song: EditorMedia = { ...clip, id: 'm.mp3', kind: 'audio' };
    let project = insertMedia(emptyProject(), clip, 0).project;
    project = insertMedia(project, silent, 99).project;
    const music = insertMedia(project, song, 0);
    project = setParam(music.project, music.ref, 'duck', true);
    const mix = audioSegments(project);
    expect(mix.map((item) => [item.mediaId, item.duck])).toEqual([
      ['v.mp4', false],
      ['m.mp3', true],
    ]);
    expect(audioSegments(setTrackFlag(project, music.ref.trackId, 'muted', true))).toHaveLength(1);
  });

  it('applies fades on top of the volume', () => {
    const fading = segment({ volumeDb: -6, fadeIn: 2, fadeOut: 2 });
    expect(gainAt(fading, 1)).toBeCloseTo(dbToGain(-6) / 2);
    expect(gainAt(fading, 5)).toBeCloseTo(dbToGain(-6));
    expect(gainAt(fading, 10)).toBe(0);
    expect(dbToGain(-60)).toBe(0);
  });

  it('ducks music while a voice is heard and eases back', () => {
    const voice = segment({ mediaId: 'voice', start: 2, duration: 2 });
    const music = segment({ mediaId: 'music', duck: true });
    const peaks = new Map([
      ['voice', new Float32Array(100).fill(0.5)],
      ['music', new Float32Array(500).fill(0.5)],
    ]);
    const active = soundActivity([voice, music], peaks, 50);
    expect(active(1)).toBe(false);
    expect(active(3)).toBe(true);
    // The ducked music never counts as a voice.
    expect(soundActivity([music], peaks, 50)(3)).toBe(false);
    const curve = duckCurve(active, 0, 10, 101);
    expect(curve[10]).toBe(1);
    expect(curve[35]).toBeCloseTo(DUCK_GAIN);
    // Released slowly: still below full level just after the voice stops at 4 s.
    expect(curve[42]).toBeLessThan(1);
    expect(curve[60]).toBe(1);
  });
});
