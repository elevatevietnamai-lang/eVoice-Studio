import { describe, expect, it } from 'vitest';
import type { EditorMedia } from './project';
import { emptyProject, secondsOf } from './project';
import { addTitleClip, findElementIn, replaceTitleClip } from './test-helpers';
import { TITLE_PARAM, defaultTitleForm, titleFormOf, titleInput, titleProblem } from './title-input';

const render = (id: string, duration: number): EditorMedia => ({
  id,
  kind: 'video',
  name: id,
  url: '/audio/promo_media/' + id,
  duration,
  width: 1080,
  height: 1920,
  has_audio: true,
});

describe('animated title form', () => {
  it('needs text, or a logo for the logo reveal', () => {
    expect(titleProblem(defaultTitleForm())).toBe('text');
    expect(titleProblem({ ...defaultTitleForm(), title: '  Hi ' })).toBeNull();
    const logo = defaultTitleForm('logo_reveal');
    expect(titleProblem(logo)).toBe('logo');
    expect(titleProblem({ ...logo, logoId: 'logo.png' })).toBeNull();
  });

  it('sends the project canvas, trimmed text and a clamped length', () => {
    const input = titleInput({ ...defaultTitleForm(), title: ' Sale ', subtitle: ' today ', seconds: 99 }, { width: 1080, height: 1920 });
    expect(input).toMatchObject({ template: 'glow_title', title: 'Sale', subtitle: 'today', duration: 15, width: 1080, height: 1920 });
    expect(input).not.toHaveProperty('lines');
    expect(input).not.toHaveProperty('logoId');
  });

  it('sends lines only for the contact card and the logo only for the logo reveal', () => {
    const card = titleInput({ ...defaultTitleForm('contact_card'), title: 'Me', lines: [' a ', '', 'c'] }, { width: 1920, height: 1080 });
    expect(card.lines).toEqual(['a', 'c']);
    const logo = titleInput({ ...defaultTitleForm('logo_reveal'), logoId: 'logo.png' }, { width: 1080, height: 1080 });
    expect(logo.logoId).toBe('logo.png');
    expect(titleInput({ ...defaultTitleForm(), title: 'x', logoId: 'logo.png' }, { width: 1, height: 1 })).not.toHaveProperty('logoId');
  });
});

describe('title clips on the timeline', () => {
  it('lays the render on an overlay track, silent, keeping the form to edit later', () => {
    const form = { ...defaultTitleForm(), title: 'Hello' };
    const { project, ref } = addTitleClip(emptyProject(), render('t1.webm', 3), 2, JSON.stringify(form));
    const element = findElementIn(project, ref);
    expect(project.tracks.overlay.some((track) => track.id === ref.trackId)).toBe(true);
    expect(secondsOf(element.startTime)).toBeCloseTo(2);
    expect(project.media.find((media) => media.id === 't1.webm')?.has_audio).toBe(false);
    expect(titleFormOf(element)).toEqual(form);
  });

  it('swaps in a new render where the old one started', () => {
    const first = addTitleClip(emptyProject(), render('t1.webm', 3), 2, JSON.stringify(defaultTitleForm()));
    const form = { ...defaultTitleForm(), title: 'Edited', seconds: 5 };
    const project = replaceTitleClip(first.project, first.ref, render('t2.webm', 5), JSON.stringify(form));
    const element = findElementIn(project, first.ref);
    expect(element.type === 'video' && element.mediaId).toBe('t2.webm');
    expect(secondsOf(element.startTime)).toBeCloseTo(2);
    expect(secondsOf(element.duration)).toBeCloseTo(5);
    expect(titleFormOf(element)?.title).toBe('Edited');
  });

  it('ignores a damaged or foreign title param', () => {
    const { project, ref } = addTitleClip(emptyProject(), render('t1.webm', 3), 0, '{bad');
    expect(titleFormOf(findElementIn(project, ref))).toBeNull();
    const element = { ...findElementIn(project, ref), params: { [TITLE_PARAM]: '{"template":"nope"}' } };
    expect(titleFormOf(element)).toBeNull();
  });
});
