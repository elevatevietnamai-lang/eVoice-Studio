import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: { installed: false, running: false },
  tracks: [] as unknown[],
  calls: [] as string[],
  stream: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: async (path: string, init?: { method?: string }) => {
    state.calls.push(`${init?.method || 'GET'} ${path}`);
    if (path === '/music/status') return state.status;
    if (path === '/music/library') return { tracks: state.tracks };
    return {};
  },
  apiPath: (path: string) => path,
  describeError: (error: unknown) => String(error),
}));
vi.mock('@/lib/api/event-stream', () => ({ consumeTaskStream: state.stream }));
vi.mock('@/lib/export-history', () => ({ saveExport: vi.fn() }));
vi.mock('@/components/bridge', () => ({ getBridge: () => null }));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: unknown }) => <header>{children as never}</header>,
}));
vi.mock('@/components/workspace-sidebar', () => ({
  SecondarySidebar: ({ children }: { children: unknown }) => <aside>{children as never}</aside>,
}));
vi.mock('@/components/waveform-player', () => ({
  WaveformPlayer: ({ src }: { src: string }) => <div data-testid="player">{src}</div>,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('@/lib/api/failure', () => ({
  gpuBusyMessage: (e: { error_code?: string }) =>
    e.error_code === 'gpu_busy' ? 'gpuBusy.dub' : undefined,
}));

import { MusicPage, installAmount } from './music-page';

const track = {
  id: 'abc123def456',
  title: 'calm lo-fi',
  prompt: 'calm lo-fi',
  lyrics: '',
  instrumental: true,
  duration: 15,
  bpm: null,
  created_at: 1_700_000_000,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MusicPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.status = { installed: false, running: false };
  state.tracks = [];
  state.calls = [];
  state.stream.mockReset();
});
afterEach(cleanup);

it('asks to install the engine first and keeps generation disabled', async () => {
  renderPage();
  expect(await screen.findByText('musicStudio.engine_install')).toBeTruthy();
  const generate = screen.getByText('musicStudio.generate').closest('button');
  expect(generate?.disabled).toBe(true);
  expect(screen.getByText('musicStudio.empty')).toBeTruthy();
});

it('streams the install and reports progress through the shared task stream', async () => {
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'progress', progress: 0.5 });
    onEvent({ type: 'done' });
  });
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.engine_install'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(state.stream.mock.calls[0][0]).toBe('/music/install-stream');
});

it('formats the install button amount per step', () => {
  expect(installAmount(null)).toBeNull();
  expect(installAmount({ stage: 'source', bytes: 0, total: null, log: '' })).toBeNull();
  expect(installAmount({ stage: 'engine', bytes: 0, total: null, log: '' })).toBeNull();
  expect(installAmount({ stage: 'engine', bytes: 1.5 * 1024 ** 3, total: null, log: '' })).toBe(
    '1.5 GB',
  );
  expect(installAmount({ stage: 'engine', bytes: 1024 ** 3, total: 3_273_066_072, log: '' })).toBe(
    '1.0 GB / 3.0 GB',
  );
  expect(
    installAmount({ stage: 'model', bytes: 512 * 1024 ** 2, total: 10_092_102_593, log: '' }),
  ).toBe('512 MB / 9.4 GB');
});

it('shows which install step is running and how much it has downloaded', async () => {
  let finish = () => {};
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({
      type: 'progress',
      progress: 0.2,
      stage: 'engine',
      bytes: 1.5 * 1024 ** 3,
      total: null,
    });
    onEvent({ type: 'log', message: 'Resolved 180 packages' });
    onEvent({
      type: 'progress',
      progress: 0.6,
      stage: 'model',
      bytes: 2 * 1024 ** 3,
      total: 10_092_102_593,
    });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    onEvent({ type: 'done' });
  });
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.engine_install'));
  expect(await screen.findByText('musicStudio.install_step_model')).toBeTruthy();
  // The button carries the downloaded amount and the model's total.
  expect(screen.getByText('2.0 GB / 9.4 GB')).toBeTruthy();
  // A new step starts without the previous step's log line.
  expect(screen.queryByText('Resolved 180 packages')).toBeNull();
  finish();
  await waitFor(() => expect(screen.queryByText('musicStudio.install_step_model')).toBeNull());
});

it('lists saved tracks, plays the first and posts a generate request as JSON', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [track];
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'done', track });
  });
  renderPage();
  const player = await screen.findByTestId('player');
  expect(player.textContent).toContain('/music/audio/abc123def456');

  const generate = screen.getByText('musicStudio.generate').closest('button') as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  const [path, , , init] = state.stream.mock.calls[0];
  expect(path).toBe('/music/generate');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toMatchObject({ instrumental: true, duration: 60, lyrics: '' });
});

it('deletes a track through the library endpoint', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [track];
  renderPage();
  fireEvent.click(await screen.findByLabelText('musicStudio.delete'));
  await waitFor(() => expect(state.calls).toContain('DELETE /music/library/abc123def456'));
});

it('shows the localized GPU-busy message when a dubbing job holds the GPU', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'error', error_code: 'gpu_busy', busy_with: 'dub', reason: 'raw english' });
  });
  renderPage();
  const generate = (await screen.findByText('musicStudio.generate')).closest(
    'button',
  ) as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('Error: gpuBusy.dub'));
});

it('keeps the failure on screen and explains the model load while progress is low', async () => {
  state.status = { installed: true, running: false };
  let finish: () => void = () => {};
  state.stream.mockImplementation(
    (_path: string, onEvent: (e: unknown) => boolean) =>
      new Promise<void>((resolve, reject) => {
        onEvent({ type: 'progress', progress: 0 });
        finish = () => {
          try {
            onEvent({ type: 'error', reason: 'Music generation failed on the music server.' });
          } catch (error) {
            reject(error);
          }
        };
        void resolve;
      }),
  );
  renderPage();
  const generate = (await screen.findByText('musicStudio.generate')).closest(
    'button',
  ) as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  expect(await screen.findByText('musicStudio.loading_model')).toBeTruthy();
  finish();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Music generation failed on the music server.');
  expect(screen.queryByText('musicStudio.loading_model')).toBeNull();
});
