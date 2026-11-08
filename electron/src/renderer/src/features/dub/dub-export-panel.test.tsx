import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  setPreferences: vi.fn(),
  saveExport: vi.fn(async (_url: string, _name: string) => undefined),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('./dub-session', () => ({ setDubExportPreferences: state.setPreferences }));
vi.mock('@/components/bridge', () => ({ getBridge: () => ({}) }));
vi.mock('@/lib/export-history', () => ({ saveExport: state.saveExport }));
vi.mock('@/lib/api/client', () => ({
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
