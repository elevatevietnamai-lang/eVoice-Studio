import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  apiJson: vi.fn(async (_path: string, _init?: RequestInit) => ({ output: 'audiogram_ab.mp4' })),
  saveExport: vi.fn(async (_url: string, _name: string) => undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/components/bridge', () => ({ getBridge: () => ({}) }));
vi.mock('@/lib/export-history', () => ({ saveExport: state.saveExport }));
vi.mock('@/lib/api/client', () => ({
  apiJson: state.apiJson,
  apiPath: (path: string) => path,
  describeError: (error: unknown) => String(error),
}));

import { AudiogramPanel, parseClock } from './audiogram-panel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('reads clock times', () => {
  expect(parseClock('0:30')).toBe(30);
  expect(parseClock('1:02:03')).toBe(3723);
  expect(parseClock('45')).toBe(45);
  expect(parseClock('1:x')).toBeNull();
  expect(parseClock('')).toBeNull();
});

it('posts the chosen slice and saves the clip', async () => {
  render(<AudiogramPanel output="audiobook_j1.m4b" title="Book" coverPath="abc.png" />);
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '1:15' } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'audiobook.audiogram_shape_vertical' }));
  fireEvent.click(screen.getByRole('button', { name: 'audiobook.audiogram_create' }));
  await waitFor(() => expect(state.saveExport).toHaveBeenCalled());
  const [path, init] = state.apiJson.mock.calls[0];
  expect(path).toBe('/longform/audiogram');
  expect(JSON.parse(String(init?.body))).toEqual({
    output: 'audiobook_j1.m4b',
    start: 75,
    duration: 20,
    shape: 'vertical',
    title: 'Book',
    cover_path: 'abc.png',
  });
  expect(state.saveExport).toHaveBeenCalledWith('/audio/audiogram_ab.mp4', 'audiogram_ab.mp4');
});

it('blocks clips longer than the limit', () => {
  render(<AudiogramPanel output="story_j2.mp3" title="" />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '301' } });
  expect(
    (screen.getByRole('button', { name: 'audiobook.audiogram_create' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
