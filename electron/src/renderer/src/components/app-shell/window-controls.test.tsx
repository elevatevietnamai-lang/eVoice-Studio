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
import appSource from '../../app.tsx?raw';

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

// Electron unions and subtracts app-region rects in document order, so a drag titlebar rendered
// after the buttons swallows their clicks. They must mount after the router and the boundary.
it('mounts after every workspace titlebar in the app root', () => {
  const controls = appSource.indexOf('<WindowControls />');
  expect(controls).toBeGreaterThan(appSource.indexOf('<RouterProvider'));
  expect(controls).toBeGreaterThan(appSource.indexOf('</ErrorBoundary>'));
});
