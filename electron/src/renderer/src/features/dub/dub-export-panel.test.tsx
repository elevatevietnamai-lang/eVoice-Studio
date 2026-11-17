import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  saveExport: vi.fn(async (_url: string, _name: string) => undefined),
  apiJson: vi.fn(async (_path: string, _init?: RequestInit) => ({})),
  calls: [] as string[],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./dub-session', () => ({ setDubExportPreferences: state.setPreferences }));
vi.mock('@/components/bridge', () => ({ getBridge: () => ({}) }));
vi.mock('@/lib/export-history', () => ({ saveExport: state.saveExport }));
vi.mock('@/lib/api/client', () => ({
  apiJson: state.apiJson,
  apiPath: (path: string) => path,
  describeError: (error: unknown) => String(error),
  errorFromResponse: async () => new Error('failed'),
}));

import { DubExportPanel } from './dub-export-panel';
import type { DubSession } from './dub-session';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const session = (exportOptions: DubSession['exportOptions']) =>
  ({
    jobId: 'job',
    inputType: 'video',
    tracks: ['de'],
    segments: [],
    exportOptions,
  }) as unknown as DubSession;

it('offers karaoke looks only while karaoke burns, and exports the chosen look', async () => {
  const { rerender } = render(
    <DubExportPanel
      session={session({ format: 'mp4', burn: true, karaoke: true, karaokeStyle: 'pop' })}
      disabled={false}
    />,
  );
  expect(screen.getByText('exportModal.karaoke_style')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'exportModal.karaoke_style_pop' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'exportModal.karaoke_style_highlight' }));
  expect(state.setPreferences).toHaveBeenCalledWith({ karaokeStyle: 'highlight' });

  fireEvent.click(screen.getByRole('button', { name: 'exportModal.export' }));
  await waitFor(() => expect(state.saveExport).toHaveBeenCalled());
  expect(state.saveExport.mock.calls[0][0]).toContain('karaoke_style=pop');

  rerender(
    <DubExportPanel
      session={session({ format: 'mp4', burn: true, karaoke: true, dual: true })}
      disabled={false}
    />,
  );
  expect(screen.queryByText('exportModal.karaoke_style')).toBeNull();

  rerender(<DubExportPanel session={session({ format: 'ass' })} disabled={false} />);
  expect(screen.getByText('exportModal.karaoke_style')).toBeTruthy();
});

it('exports burned subtitles with the original audio before any dub is generated', async () => {
  state.apiJson.mockImplementation(async (path: string) => {
    state.calls.push(path);
    return {};
  });
  state.saveExport.mockImplementation(async (url: string) => {
    state.calls.push(url);
    return undefined;
  });
  const untranslated = {
    ...session({ format: 'subtitled' }),
    tracks: [],
    target: 'Vietnamese',
    segments: [{ id: 'a', start: 0, end: 1, text: '你好', text_original: '你好' }],
  } as unknown as DubSession;
  const { rerender } = render(<DubExportPanel session={untranslated} disabled={false} />);
  expect(screen.getByRole('button', { name: 'exportModal.subtitled_video' })).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'exportModal.export' }) as HTMLButtonElement).disabled,
  ).toBe(true);

  const translated = {
    ...untranslated,
    segments: [
      {
        id: 'a',
        start: 0,
        end: 1,
        text: 'Xin chào',
        text_original: '你好',
        translations: { vi: 'Xin chào' },
      },
    ],
  } as unknown as DubSession;
  rerender(<DubExportPanel session={translated} disabled={false} />);
  expect(screen.getByText('exportModal.subtitled_note')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'exportModal.export' }));
  await waitFor(() => expect(state.saveExport).toHaveBeenCalled());
  const [path, init] = state.apiJson.mock.calls[0];
  expect(path).toBe('/dub/subtitle-cues/job');
  expect(JSON.parse(String(init?.body))).toEqual({
    lang: 'vi',
    cues: [{ id: 'a', start: 0, end: 1, text: 'Xin chào', text_original: '你好' }],
  });
  // Cues are stored before the export reads them.
  expect(state.calls[0]).toBe('/dub/subtitle-cues/job');
  expect(state.calls[1]).toContain('subtitles_only=true');
  expect(state.calls[1]).toContain('lang=vi');
});

it('hides the subtitled video export for audio-only jobs', () => {
  render(
    <DubExportPanel
      session={{ ...session({}), inputType: 'audio' } as unknown as DubSession}
      disabled={false}
    />,
  );
  expect(screen.queryByRole('button', { name: 'exportModal.subtitled_video' })).toBeNull();
});
