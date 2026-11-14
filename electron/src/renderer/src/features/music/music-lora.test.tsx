import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  lora: { selected: false } as Record<string, unknown>,
  calls: [] as { method: string; body?: unknown }[],
  bridge: null as null | { files: { authorizeMusicLora: ReturnType<typeof vi.fn> } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('@/lib/api/client', () => ({
  apiJson: async (path: string, init?: { method?: string; body?: string }) => {
    expect(path).toBe('/music/lora');
    const method = init?.method || 'GET';
    state.calls.push({ method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST')
      state.lora = {
        selected: true,
        name: 'style.safetensors',
        scale: 1,
        enabled: true,
        model: 'sft',
        available: true,
      };
    if (method === 'DELETE') state.lora = { selected: false };
    return state.lora;
  },
  describeError: (error: unknown) => String(error),
}));
vi.mock('@/components/bridge', () => ({ getBridge: () => state.bridge }));

import { MusicLora } from './music-lora';

function renderLora(model: 'turbo' | 'sft' = 'sft') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MusicLora model={model} disabled={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.lora = { selected: false };
  state.calls = [];
  state.bridge = {
    files: {
      authorizeMusicLora: vi.fn(async () => ({ authorization: 'a'.repeat(64), path: 'C:/x' })),
    },
  };
});
afterEach(cleanup);

it('is hidden outside the desktop app when no LoRA is chosen', async () => {
  state.bridge = null;
  const { container } = renderLora();
  await waitFor(() => expect(state.calls).toHaveLength(1));
  expect(container.textContent).toBe('');
});

it('sends only the grant from the native picker, never a path', async () => {
  renderLora();
  fireEvent.click(await screen.findByText('musicStudio.lora_pick_folder'));
  await waitFor(() => expect(state.calls.some((call) => call.method === 'POST')).toBe(true));
  expect(state.bridge?.files.authorizeMusicLora).toHaveBeenCalledWith('folder');
  const post = state.calls.find((call) => call.method === 'POST');
  expect(post?.body).toEqual({ authorization: 'a'.repeat(64), model: 'sft' });
  expect(await screen.findByText('style.safetensors')).toBeTruthy();
});

it('warns when the LoRA was picked for another model, and removes it', async () => {
  state.lora = {
    selected: true,
    name: 'style.safetensors',
    scale: 0.5,
    enabled: true,
    model: 'sft',
    available: false,
  };
  renderLora('turbo');
  expect(await screen.findByText('musicStudio.lora_missing')).toBeTruthy();
  expect(screen.getByText(/musicStudio.lora_model_mismatch/)).toBeTruthy();
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() =>
    expect(state.calls.find((call) => call.method === 'PATCH')?.body).toEqual({ enabled: false }),
  );
  fireEvent.click(screen.getByText('musicStudio.lora_remove'));
  await waitFor(() => expect(state.calls.some((call) => call.method === 'DELETE')).toBe(true));
});
