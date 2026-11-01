import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const windowApi = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(async () => false),
  onMaximizedChange: vi.fn((_cb: (maximized: boolean) => void) => () => {}),
}));
const platform = vi.hoisted(() => ({ mac: false, bridge: true }));
vi.mock('@/components/bridge', () => ({
  getBridge: () => (platform.bridge ? { window: windowApi } : undefined),
  isMac: () => platform.mac,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { WindowControls } from './window-controls';

afterEach(() => {
  cleanup();
  platform.mac = false;
  platform.bridge = true;
  vi.clearAllMocks();
});

it('drives the window through the bridge', () => {
  render(<WindowControls />);
  fireEvent.click(screen.getByRole('button', { name: 'windowControls.minimize' }));
  fireEvent.click(screen.getByRole('button', { name: 'windowControls.maximize' }));
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(windowApi.minimize).toHaveBeenCalledOnce();
  expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
  expect(windowApi.close).toHaveBeenCalledOnce();
});

it('offers restore while the window is maximized', async () => {
  windowApi.isMaximized.mockResolvedValueOnce(true);
  render(<WindowControls />);
  expect(await screen.findByRole('button', { name: 'windowControls.restore' })).toBeInTheDocument();
});

it('renders nothing on macOS or without the desktop bridge', () => {
  platform.mac = true;
  const { container, rerender } = render(<WindowControls />);
  expect(container).toBeEmptyDOMElement();
  platform.mac = false;
  platform.bridge = false;
  rerender(<WindowControls />);
  expect(container).toBeEmptyDOMElement();
});
