import { describe, expect, it } from 'vitest';
import {
  emptyProject,
  findElement,
  loadProject,
  MAIN_TRACK_ID,
  PROJECT_KEY,
  projectSeconds,
  saveProject,
  secondsOf,
  type EditorMedia,
  type EditorProject,
  type ElementRef,
} from './project';
import {
  addCaptions,
  addText,
  captionsFromText,
  deleteElement,
  hasKeyframes,
  insertMedia,
  keyframeAt,
  moveElement,
  removeKeyframe,
  setKeyframe,
  setSpeed,
  splitElement,
  trimElement,
  wrapCaption,
} from './timeline-ops';

const clip = (id: string, duration: number): EditorMedia => ({
  id,
  kind: 'video',
  name: id,
  url: `/audio/promo_media/${id}`,
  duration,
  width: 1080,
  height: 1920,
  has_audio: true,
});
const song: EditorMedia = { ...clip('song.mp3', 30), kind: 'audio', width: null, height: null };
const still: EditorMedia = { ...clip('logo.png', 0), kind: 'image', duration: null };

/** [start, duration] in seconds for every clip on the main track. */
const mainLayout = (project: EditorProject) =>
  project.tracks.main.elements.map((element) => [secondsOf(element.startTime), secondsOf(element.duration)]);
const element = (project: EditorProject, ref: ElementRef) => findElement(project, ref)!.element;

function threeClips() {
  let project = emptyProject();
  const refs: ElementRef[] = [];
  for (const [media, at] of [
    [clip('a.mp4', 4), 0],
    [clip('b.mp4', 6), 99],
    [clip('c.mp4', 2), 99],
  ] as const) {
    const added = insertMedia(project, media, at);
    project = added.project;
    refs.push(added.ref);
  }
  return { project, refs };
}

describe('main track', () => {
  it('keeps clips end to end and inserts at the playhead', () => {
    const { project } = threeClips();
    expect(mainLayout(project)).toEqual([
      [0, 4],
      [4, 6],
      [10, 2],
    ]);
    // Dropped at 3 s (before the middle of b) it goes between a and b.
    const inserted = insertMedia(project, clip('d.mp4', 1), 3).project;
    expect(inserted.tracks.main.elements.map((item) => item.mediaId)).toEqual(['a.mp4', 'd.mp4', 'b.mp4', 'c.mp4']);
    expect(projectSeconds(inserted)).toBe(13);
  });

  it('ripples a trim, a split and a delete', () => {
    const { project, refs } = threeClips();
    const trimmed = trimElement(project, refs[1], 'end', 7);
    expect(mainLayout(trimmed)).toEqual([
      [0, 4],
      [4, 3],
      [7, 2],
    ]);
    const b = element(trimmed, refs[1]);
    expect(secondsOf(b.trimEnd)).toBe(3);
    // Trimming the left edge hides source but the clip stays in place.
    const left = trimElement(trimmed, refs[1], 'start', 5);
    expect(mainLayout(left)[1]).toEqual([4, 2]);
    expect(secondsOf(element(left, refs[1]).trimStart)).toBe(1);

    const split = splitElement(left, refs[1], 5);
    expect(mainLayout(split.project)).toEqual([
      [0, 4],
      [4, 1],
      [5, 1],
      [6, 2],
    ]);
    expect(secondsOf(element(split.project, split.ref).trimStart)).toBe(2);
    expect(mainLayout(deleteElement(split.project, refs[0]))[0]).toEqual([0, 1]);
  });

  it('never reveals more source than the clip has', () => {
    const { project, refs } = threeClips();
    expect(mainLayout(trimElement(project, refs[0], 'end', 60))[0]).toEqual([0, 4]);
    expect(mainLayout(trimElement(project, refs[0], 'start', -5))[0]).toEqual([0, 4]);
    // A still has no source limit.
    const withStill = insertMedia(project, still, 99).project;
    const ref = { trackId: MAIN_TRACK_ID, elementId: withStill.tracks.main.elements[3].id };
    expect(mainLayout(trimElement(withStill, ref, 'end', 30))[3]).toEqual([12, 18]);
  });

  it('reorders by moving a clip', () => {
    const { project, refs } = threeClips();
    const moved = moveElement(project, refs[2], 0).project;
    expect(moved.tracks.main.elements.map((item) => item.mediaId)).toEqual(['c.mp4', 'a.mp4', 'b.mp4']);
    expect(mainLayout(moved)[0]).toEqual([0, 2]);
  });
});

describe('speed', () => {
  it('shortens a faster clip and ripples, keeping its source', () => {
    const { project, refs } = threeClips();
    const fast = setSpeed(project, refs[1], 2);
    expect(mainLayout(fast)).toEqual([
      [0, 4],
      [4, 3],
      [7, 2],
    ]);
    const b = element(fast, refs[1]);
    expect('retime' in b && b.retime?.rate).toBe(2);
    // Splitting a 2x clip at 1 s of timeline cuts 2 s into the source.
    const split = splitElement(fast, refs[1], 5);
    expect(secondsOf(element(split.project, split.ref).trimStart)).toBe(2);
    expect(mainLayout(setSpeed(fast, refs[1], 1))[1]).toEqual([4, 6]);
  });
});

describe('free tracks', () => {
  it('puts overlapping overlays and audio on new tracks', () => {
    let project = threeClips().project;
    const first = addText(project, 1, 'Hello');
    project = first.project;
    const second = addText(project, 2, 'World');
    project = second.project;
    expect(project.tracks.overlay).toHaveLength(2);
    expect(second.ref.trackId).not.toBe(first.ref.trackId);
    // A later title fits on the first text track again.
    const third = addText(project, 10, 'Bye');
    expect(third.ref.trackId).toBe(project.tracks.overlay.find((track) => track.id === third.ref.trackId)!.id);
    expect(third.project.tracks.overlay).toHaveLength(2);

    const music = insertMedia(project, song, 0);
    expect(music.ref.trackId).toBe(music.project.tracks.audio[0].id);
  });

  it('moves a title onto a free track and drops the empty one', () => {
    const base = threeClips().project;
    const a = addText(base, 0, 'A');
    const b = addText(a.project, 1, 'B');
    expect(b.project.tracks.overlay).toHaveLength(2);
    const moved = moveElement(b.project, b.ref, 5, a.ref.trackId);
    expect(moved.ref.trackId).toBe(a.ref.trackId);
    expect(moved.project.tracks.overlay).toHaveLength(1);
    // A title cannot land on the video main track.
    expect(moveElement(b.project, b.ref, 5, MAIN_TRACK_ID).project).toBe(b.project);
  });

  it('stops a free clip at its neighbours when trimming', () => {
    const base = threeClips().project;
    const a = addText(base, 0, 'A');
    const b = addText(a.project, 5, 'B');
    expect(b.ref.trackId).toBe(a.ref.trackId);
    const longer = trimElement(b.project, a.ref, 'end', 9);
    expect(secondsOf(element(longer, a.ref).duration)).toBe(5);
  });
});

describe('keyframes', () => {
  it('sets, finds and removes a keyframe at the playhead and keeps it through a split', () => {
    const { project, refs } = threeClips();
    let next = setKeyframe(project, refs[1], 'opacity', 5, 0);
    next = setKeyframe(next, refs[1], 'opacity', 8, 1);
    const b = element(next, refs[1]);
    expect(hasKeyframes(b, 'opacity')).toBe(true);
    expect(keyframeAt(b, 'opacity', 5)?.value).toBe(0);
    expect(keyframeAt(b, 'opacity', 6)).toBeNull();
    const split = splitElement(next, refs[1], 7);
    expect(keyframeAt(element(split.project, split.ref), 'opacity', 8)?.value).toBe(1);
    expect(hasKeyframes(element(removeKeyframe(next, refs[1], 'opacity', 5), refs[1]), 'opacity')).toBe(true);
  });
});

describe('captions', () => {
  it('puts each spoken segment on one caption track without overlaps', () => {
    const { project } = threeClips();
    const next = addCaptions(
      project,
      [
        { start: 2, end: 4.5, text: ' second ' },
        { start: 0.5, end: 2.5, text: 'first' },
        { start: 5, end: 5.1, text: 'short' },
        { start: null, end: 3, text: 'no timing' },
        { start: 7, end: 8, text: '   ' },
      ],
      { width: 1080, height: 1920 },
    );
    expect(next.tracks.overlay).toHaveLength(1);
    const captions = next.tracks.overlay[0].elements.map((element) => [
      element.params.content,
      secondsOf(element.startTime),
      secondsOf(element.duration),
    ]);
    // "first" stops where "second" starts; "short" is held for the minimum.
    expect(captions).toEqual([
      ['first', 0.5, 1.5],
      ['second', 2, 2.5],
      ['short', 5, 0.4],
    ]);
    expect(next.tracks.overlay[0].elements[0].params['background.enabled']).toBe(true);
    expect(addCaptions(project, [], { width: 1080, height: 1920 })).toBe(project);
  });

  it('wraps a caption to fit the frame', () => {
    // 64 px text on a 1080 px wide frame fits about 26 characters a line.
    expect(wrapCaption('Welcome to the video editor this sentence', { width: 1080, height: 1920 })).toBe(
      'Welcome to the video\neditor this sentence',
    );
    expect(wrapCaption('Short line', { width: 1920, height: 1080 })).toBe('Short line');
  });
});

describe('captions without timings', () => {
  it('breaks a transcript into short lines spread over the speech', () => {
    const lines = captionsFromText('Welcome to the editor. This sentence becomes a caption, and here is the last line.', 1, 7);
    expect(lines.map((line) => line.text)).toEqual([
      'Welcome to the editor.',
      'This sentence becomes a caption,',
      'and here is the last line.',
    ]);
    expect(lines[0].start).toBe(1);
    expect(lines.at(-1)!.end).toBeCloseTo(7);
    // Longer lines get more time.
    expect(lines[1].end! - lines[1].start!).toBeGreaterThan(lines[0].end! - lines[0].start!);
    expect(captionsFromText('one two three four five six seven eight', 0, 2).map((l) => l.text)).toEqual([
      'one two three four five six seven',
      'eight',
    ]);
    expect(captionsFromText('', 0, 2)).toEqual([]);
  });
});

describe('storage', () => {
  it('round-trips a project and falls back to an empty one', () => {
    const { project } = threeClips();
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) };
    saveProject(project, storage);
    expect(loadProject(storage)).toEqual(project);
    store.set(PROJECT_KEY, '{broken');
    expect(loadProject(storage)).toEqual(emptyProject());
  });
});
