import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject } from './project';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  bridge: true,
  state: 'ready' as string,
  promo: {
    browserState: vi.fn(),
    onBrowserState: vi.fn(() => () => {}),
    onRenderProgress: vi.fn(() => () => {}),
    renderOverlay: vi.fn(),
    cancelRender: vi.fn(),
    installBrowser: vi.fn(),
  },
}));
vi.mock('@/components/bridge', () => ({ getBridge: () => (mocks.bridge ? { promo: mocks.promo } : undefined) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { AnimatedTitleDialog } from './animated-title';

afterEach(() => {
  cleanup();
  mocks.bridge = true;
  vi.clearAllMocks();
});

function show(state: string) {
  mocks.promo.browserState.mockResolvedValue({ state });
  const onRendered = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AnimatedTitleDialog open onOpenChange={onOpenChange} project={emptyProject()} initial={null} onRendered={onRendered} />,
  );
  return { onRendered, onOpenChange };
}

it('says it needs the desktop app in the browser build', () => {
  mocks.bridge = false;
  show('ready');
  expect(screen.getByText('editor.title_desktop_only')).toBeInTheDocument();
});

it('sends a missing browser to the Promo page and never downloads it here', async () => {
  for (const state of ['missing', 'installing', 'error']) {
    const { onOpenChange } = show(state);
    fireEvent.click(await screen.findByRole('button', { name: 'editor.title_open_promo' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/promo' });
    cleanup();
  }
  expect(mocks.promo.installBrowser).not.toHaveBeenCalled();
  expect(mocks.promo.renderOverlay).not.toHaveBeenCalled();
});

it('renders through the Promo bridge and hands back a silent clip', async () => {
  mocks.promo.renderOverlay.mockResolvedValue({
    ok: true,
    media: { id: 'title.webm', kind: 'video', name: 'title.webm', url: '/x', duration: 3, width: 1080, height: 1920, has_audio: true },
  });
  const { onRendered, onOpenChange } = show('ready');
  const render = await screen.findByRole('button', { name: 'editor.title_render' });
  expect(render).toBeDisabled();
  fireEvent.change(screen.getByLabelText('editor.title_text'), { target: { value: 'Big sale' } });
  fireEvent.click(render);
  await waitFor(() => expect(onRendered).toHaveBeenCalledOnce());
  expect(mocks.promo.renderOverlay).toHaveBeenCalledWith(
    expect.objectContaining({ template: 'glow_title', title: 'Big sale', width: 1080, height: 1920 }),
    30,
  );
  expect(onRendered.mock.calls[0][0]).toMatchObject({ id: 'title.webm', name: 'Big sale', has_audio: false });
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(mocks.promo.installBrowser).not.toHaveBeenCalled();
});

it('explains a failed render and keeps the dialog open', async () => {
  mocks.promo.renderOverlay.mockResolvedValue({ ok: false, code: 'network_blocked' });
  const { onRendered, onOpenChange } = show('ready');
  fireEvent.change(await screen.findByLabelText('editor.title_text'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'editor.title_render' }));
  expect(await screen.findByText('editor.title_error_network_blocked')).toBeInTheDocument();
  expect(onRendered).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});
