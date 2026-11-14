import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: { installed: false, running: false },
  tracks: [] as unknown[],
  calls: [] as string[],
  stream: vi.fn(),
  format: null as unknown,
  models: [] as { id: string; installed: boolean; download_bytes: number }[],
  lm: { model: null, ready: false, download_bytes: 0 } as {
    model: string | null;
    ready: boolean;
    download_bytes: number;
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: async (path: string, init?: { method?: string }) => {
    state.calls.push(`${init?.method || 'GET'} ${path}`);
    if (path === '/music/status') return state.status;
    if (path === '/music/library') return { tracks: state.tracks };
    if (path === '/music/lm') return state.lm;
    if (path === '/music/format') return state.format;
    if (path === '/music/models') return { models: state.models };
    if (path === '/music/upload')
      return { upload_id: 'fedcba987654', name: 'demo.mp3', duration: 42.5 };
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
  state.lm = { model: null, ready: false, download_bytes: 0 };
  state.format = null;
  state.models = [
    { id: 'turbo', installed: true, download_bytes: 0 },
    { id: 'sft', installed: false, download_bytes: 4_791_792_772 },
    { id: 'base', installed: true, download_bytes: 0 },
  ];
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

it('sends the language, key, meter, seed and Thinking it shows', async () => {
  state.status = { installed: true, running: false };
  state.lm = { model: 'acestep-5Hz-lm-1.7B', ready: true, download_bytes: 0 };
  state.stream.mockImplementation(async () => {});
  renderPage();
  const thinking = (await screen.findByText('musicStudio.thinking')).closest('label');
  const toggle = thinking?.querySelector('[role="switch"]') as HTMLElement;
  await waitFor(() => expect(toggle.getAttribute('aria-disabled')).not.toBe('true'));
  fireEvent.click(toggle);
  fireEvent.click(screen.getByText('musicStudio.advanced'));
  fireEvent.click(await screen.findByText('3/4'));
  fireEvent.change(screen.getByPlaceholderText('musicStudio.seed_hint'), {
    target: { value: '42x' },
  });
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  const body = JSON.parse(state.stream.mock.calls[0][3].body);
  expect(body).toMatchObject({
    thinking: true,
    time_signature: '3',
    seed: 42,
    key_scale: '',
    vocal_language: 'en',
  });
});

it('offers the small language model download instead of a dead Thinking switch', async () => {
  state.status = { installed: true, running: false };
  state.lm = { model: 'acestep-5Hz-lm-0.6B', ready: false, download_bytes: 1_372_702_240 };
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'done' });
  });
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.thinking_download'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(state.stream.mock.calls[0][0]).toBe('/music/lm-install-stream');
});

it('explains when the GPU cannot run Thinking and never sends it', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async () => {});
  renderPage();
  expect(await screen.findByText('musicStudio.thinking_unsupported')).toBeTruthy();
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body).thinking).toBe(false);
});

it('reuses the seed a saved track was made with', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [{ ...track, seed: 777 }];
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.reuse_seed'));
  expect((screen.getByPlaceholderText('musicStudio.seed_hint') as HTMLInputElement).value).toBe(
    '777',
  );
});

it('sends the variants, steps, sampler and file format it shows', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.advanced'));
  fireEvent.click(await screen.findByText('3'));
  fireEvent.click(screen.getByText('musicStudio.sampler_sde'));
  fireEvent.click(screen.getByText('FLAC'));
  fireEvent.click(screen.getByText('musicStudio.generate_many'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body)).toMatchObject({
    batch_size: 3,
    inference_steps: 8,
    infer_method: 'sde',
    audio_format: 'flac',
  });
});

it('selects the first variant as soon as it is saved', async () => {
  state.status = { installed: true, running: false };
  const second = { ...track, id: 'bbbbbbbbbbbb', variant: 2, batch_id: 'abc123def456' };
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'track', track: { ...track, variant: 1, batch_id: 'abc123def456' } });
    onEvent({ type: 'track', track: second });
    onEvent({ type: 'done', track, tracks: [track, second] });
  });
  state.tracks = [second, { ...track, variant: 1 }];
  renderPage();
  const generate = (await screen.findByText('musicStudio.generate')).closest(
    'button',
  ) as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() =>
    expect(screen.getByTestId('player').textContent).toContain('/music/audio/abc123def456'),
  );
});

it('inserts a section tag into the lyrics and a style tag into the description', async () => {
  state.status = { installed: true, running: false };
  renderPage();
  const instrumental = (await screen.findByText('musicStudio.instrumental')).closest('label');
  fireEvent.click(instrumental?.querySelector('[role="switch"]') as HTMLElement);
  fireEvent.click(await screen.findByText('[chorus]'));
  const lyrics = screen.getByPlaceholderText(
    'musicStudio.lyrics_placeholder',
  ) as HTMLTextAreaElement;
  expect(lyrics.value).toBe('[chorus]\n');
  fireEvent.click(screen.getByText('musicStudio.style_tags'));
  fireEvent.click(await screen.findByText('piano'));
  const prompt = screen.getByPlaceholderText(
    'musicStudio.prompt_placeholder',
  ) as HTMLTextAreaElement;
  expect(prompt.value.endsWith(', piano')).toBe(true);
});

it('reuses all of a saved track settings', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [{ ...track, prompt: 'warm jazz', seed: 9, inference_steps: 6, ext: 'mp3' }];
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.reuse_settings'));
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body)).toMatchObject({
    prompt: 'warm jazz',
    seed: 9,
    inference_steps: 6,
    audio_format: 'mp3',
    batch_size: 1,
  });
});

it('offers Format only with a ready language model and shows the suggestion before applying', async () => {
  state.status = { installed: true, running: false };
  renderPage();
  await screen.findByText('musicStudio.thinking_unsupported');
  expect(screen.queryByText('musicStudio.format')).toBeNull();
  cleanup();

  state.lm = { model: 'acestep-5Hz-lm-1.7B', ready: true, download_bytes: 0 };
  state.format = {
    caption: 'warm lofi, vinyl crackle',
    lyrics: '',
    bpm: 84,
    key_scale: '',
    time_signature: '',
    duration: null,
    vocal_language: '',
  };
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.format'));
  await waitFor(() => expect(state.calls).toContain('POST /music/format'));
  expect(await screen.findByText('musicStudio.format_title')).toBeTruthy();
  expect(screen.getByText('warm lofi, vinyl crackle')).toBeTruthy();
  fireEvent.click(screen.getByText('musicStudio.format_apply'));
  const prompt = screen.getByPlaceholderText(
    'musicStudio.prompt_placeholder',
  ) as HTMLTextAreaElement;
  await waitFor(() => expect(prompt.value).toBe('warm lofi, vinyl crackle'));
  expect((screen.getByPlaceholderText('musicStudio.bpm_hint') as HTMLInputElement).value).toBe(
    '84',
  );
});

it('covers the selected track with its id and strength, never a path', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [{ ...track, duration: 90 }];
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.cover_this'));
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  const body = JSON.parse(state.stream.mock.calls[0][3].body);
  expect(body).toMatchObject({
    task: 'cover',
    source_track_id: 'abc123def456',
    cover_strength: 0.7,
  });
  expect(JSON.stringify(body)).not.toMatch(/path/);
});

it('repaints the middle third of the selected track by default', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [{ ...track, duration: 90 }];
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.repaint_this'));
  fireEvent.click(screen.getByText('musicStudio.repaint_mode_aggressive'));
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body)).toMatchObject({
    task: 'repaint',
    source_track_id: 'abc123def456',
    repaint_start: 30,
    repaint_end: 60,
    repaint_mode: 'aggressive',
  });
});

it('extends the selected track before its start, with the join and how much to change', async () => {
  state.status = { installed: true, running: false };
  state.tracks = [{ ...track, duration: 90 }];
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.extend_this'));
  fireEvent.click(screen.getByText('musicStudio.extend_side_start'));
  fireEvent.click(screen.getByText('musicStudio.repaint_mode_conservative'));
  // Extend has no region to pick: the region slider belongs to Repaint.
  expect(screen.queryByText('musicStudio.repaint_region')).toBeNull();
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  const body = JSON.parse(state.stream.mock.calls[0][3].body);
  expect(body).toMatchObject({
    task: 'extend',
    source_track_id: 'abc123def456',
    extend_side: 'start',
    extend_seconds: 30,
    extend_overlap: 2,
    repaint_mode: 'conservative',
  });
  expect(body).not.toHaveProperty('repaint_start');
});

it('shows the language model options only with Thinking and sends only what was changed', async () => {
  state.status = { installed: true, running: false };
  state.lm = { model: 'acestep-5Hz-lm-0.6B', ready: true, download_bytes: 0 };
  state.stream.mockImplementation(async () => {});
  renderPage();
  const thinking = (await screen.findByText('musicStudio.thinking')).closest('label');
  const toggle = thinking?.querySelector('[role="switch"]') as HTMLElement;
  await waitFor(() => expect(toggle.getAttribute('aria-disabled')).not.toBe('true'));
  expect(screen.queryByText('musicStudio.lm_expert')).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(await screen.findByText('musicStudio.lm_expert'));
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalledTimes(1));
  const untouched = JSON.parse(state.stream.mock.calls[0][3].body);
  expect(Object.keys(untouched).filter((key) => key.startsWith('lm_'))).toEqual([]);
  fireEvent.change(screen.getByPlaceholderText('NO USER INPUT'), {
    target: { value: 'no drums' },
  });
  fireEvent.click(screen.getByText('musicStudio.generate'));
  await waitFor(() => expect(state.stream).toHaveBeenCalledTimes(2));
  expect(JSON.parse(state.stream.mock.calls[1][3].body)).toMatchObject({
    thinking: true,
    lm_negative_prompt: 'no drums',
  });
});

it('keeps an edit disabled until it has a source, then uses an uploaded file by id', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async () => {});
  const { container } = renderPage();
  fireEvent.click(await screen.findByText('musicStudio.task_cover'));
  const generate = screen.getByText('musicStudio.generate').closest('button') as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['ID3'], 'demo.mp3')] } });
  await waitFor(() => expect(state.calls).toContain('POST /music/upload'));
  expect(await screen.findByText('demo.mp3')).toBeTruthy();
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body)).toMatchObject({
    task: 'cover',
    source_upload_id: 'fedcba987654',
  });
});

it('offers the SFT download and keeps generation off until the chosen model is there', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'done' });
  });
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.advanced'));
  fireEvent.click(await screen.findByText('musicStudio.model_sft'));
  const generate = screen.getByText('musicStudio.generate').closest('button') as HTMLButtonElement;
  fireEvent.click(await screen.findByText('musicStudio.model_download'));
  expect(generate.disabled).toBe(true);
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(state.stream.mock.calls[0][0]).toBe('/music/model-install-stream?model=sft');
});

it('sends guidance only for a model that takes it, with the steps of that model', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async () => {});
  renderPage();
  fireEvent.click(await screen.findByText('musicStudio.advanced'));
  expect(screen.queryByText('musicStudio.guidance')).toBeNull();
  fireEvent.click(await screen.findByText('musicStudio.model_base'));
  expect(await screen.findByText('musicStudio.guidance')).toBeTruthy();
  const generate = screen.getByText('musicStudio.generate').closest('button') as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(JSON.parse(state.stream.mock.calls[0][3].body)).toMatchObject({
    model: 'base',
    inference_steps: 32,
    guidance_scale: 7,
    shift: 3,
    use_adg: false,
    cfg_interval_start: 0,
    cfg_interval_end: 1,
  });
});

it('offers the stem tasks only on the Base model and sends the instruments picked', async () => {
  state.status = { installed: true, running: false };
  state.stream.mockImplementation(async () => {});
  const { container } = renderPage();
  const extract = (await screen.findByText('musicStudio.task_extract')).closest('button');
  expect(
    extract?.hasAttribute('disabled') || extract?.getAttribute('aria-disabled') === 'true',
  ).toBe(true);
  expect(screen.getByText('musicStudio.task_base_only')).toBeTruthy();
  fireEvent.click(screen.getByText('musicStudio.advanced'));
  fireEvent.click(await screen.findByText('musicStudio.model_base'));
  await waitFor(() => expect(screen.queryByText('musicStudio.task_base_only')).toBeNull());
  fireEvent.click(screen.getByText('musicStudio.task_complete'));
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['ID3'], 'demo.mp3')] } });
  expect(await screen.findByText('demo.mp3')).toBeTruthy();
  // Drums and bass start picked; drop drums, add strings.
  fireEvent.click(screen.getByText('musicStudio.track_drums'));
  fireEvent.click(screen.getByText('musicStudio.track_strings'));
  const generate = screen.getByText('musicStudio.generate').closest('button') as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  const body = JSON.parse(state.stream.mock.calls[0][3].body);
  expect(body).toMatchObject({
    task: 'complete',
    model: 'base',
    source_upload_id: 'fedcba987654',
    track_classes: ['bass', 'strings'],
  });
  expect(body).not.toHaveProperty('track_name');
  // Leaving Base goes back to a new song.
  fireEvent.click(screen.getByText('musicStudio.model_turbo'));
  await waitFor(() => expect(screen.getByText('musicStudio.task_text2music_help')).toBeTruthy());
});
