import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ installed: false, fail: false, stream: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/api/client', () => ({
  apiJson: async () => {
    if (state.fail) throw new Error('down');
    return { installed: state.installed };
  },
  describeError: (error: unknown) => String(error),
}));
vi.mock('@/lib/api/event-stream', () => ({ consumeTaskStream: state.stream }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupHardsubEngine } from './hardsub-setup';

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SetupHardsubEngine />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.installed = false;
  state.fail = false;
  state.stream.mockReset();
});
afterEach(cleanup);

it('offers an optional install and streams it through the hardsub install endpoint', async () => {
  state.stream.mockImplementation(async (_path: string, onEvent: (e: unknown) => boolean) => {
    onEvent({ type: 'progress', progress: 0.5 });
    onEvent({ type: 'done' });
  });
  renderCard();
  expect(await screen.findByText(/firstrun.chip_optional/)).toBeTruthy();
  fireEvent.click(screen.getByText('dub_hardsub.install'));
  await waitFor(() => expect(state.stream).toHaveBeenCalled());
  expect(state.stream.mock.calls[0][0]).toBe('/dub/hardsub/install-stream');
});

it('stays hidden once the engine is installed or the status is unavailable', async () => {
  state.installed = true;
  const { container } = renderCard();
  await waitFor(() => expect(container.querySelector('section')).toBeNull());
  cleanup();
  state.installed = false;
  state.fail = true;
  const second = renderCard();
  await new Promise((r) => setTimeout(r, 50));
  expect(second.container.querySelector('section')).toBeNull();
});
