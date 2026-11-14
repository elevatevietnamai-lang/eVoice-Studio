import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const setMenuGroup = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { version?: string }) =>
      values?.version ? `${key}:${values.version}` : key,
  }),
}));
vi.mock('@/lib/store/workspace', () => ({ setMenuGroup, useMenuGroup: () => null }));
const bridge = vi.hoisted(() => ({
  mac: false,
  popup: vi.fn(async (_point: { x: number; y: number }) => {}),
}));
vi.mock('@/components/bridge', () => ({
  appVersion: () => '0.5.7',
  isMac: () => bridge.mac,
  getBridge: () => ({ app: { menu: { popup: bridge.popup } } }),
}));
vi.mock('@/hooks/use-window-fullscreen', () => ({ useWindowFullscreen: () => false }));
vi.mock('./workspace-menu', () => ({ WorkspaceNavigation: () => <nav /> }));
vi.mock('./status-bar', () => ({ StatusBar: () => null }));
import { versionTranslationKey, WorkspaceSidebar } from './workspace-sidebar';

afterEach(() => {
  cleanup();
  bridge.mac = false;
  bridge.popup.mockClear();
});

it('is always the icon rail: no sidebar or panel toggle', () => {
  render(<WorkspaceSidebar />);
  // The only button is the application menu (Windows and Linux).
  expect(screen.queryAllByRole('button').map((button) => button.dataset.slot)).toEqual([
    'app-menu-button',
  ]);
  expect(screen.queryByLabelText('clone.toggle_sidebar')).toBeNull();
  expect(screen.queryByLabelText(/paneActions\./)).toBeNull();
});

it("links the logo Home, named with the app version, drawn with the app icon's own mark", () => {
  render(<WorkspaceSidebar />);
  const logo = screen.getByRole('link', { name: /^app\.name app\.version/ });
  expect(logo).toHaveAttribute('href', '/');
  // The link is exactly the mark's size: no padding box around it.
  expect(logo).toHaveClass('size-8');
  // A brand mark: no hover or pressed fill (ghost button styles), only a focus ring.
  expect(logo.className).not.toMatch(/hover:|active:|aria-expanded:/);
  const mark = logo.querySelector('svg')!;
  expect(mark).toHaveAttribute('width', '32');
  expect(mark).toHaveAttribute('data-mark', 'full');
  // Bare (no tile) in both themes, cropped to the ink so the bars reach the edges.
  expect(mark).toHaveAttribute('data-tone', 'ink');
  expect(mark).toHaveAttribute('data-tile', 'none');
  expect(mark).toHaveAttribute('data-crop', 'true');
});

it('groups the foot of the rail: system status, then the app menu above Settings', () => {
  render(<WorkspaceSidebar />);
  const app = document.querySelector('[data-slot="rail-app"]')!;
  expect(app).toHaveAttribute('role', 'group');
  expect(document.querySelector('[data-slot="rail-system"]')).toHaveAttribute('role', 'group');
  const [menu, settings] = [...app.children];
  expect(menu).toHaveAttribute('data-slot', 'app-menu-button');
  expect(menu).toHaveAttribute('aria-label', 'shell.app_menu');
  expect(settings).toHaveAttribute('href', '/settings');
  // Native `title` would double the tooltip.
  expect(app.querySelector('[title]')).toBeNull();
});

it('opens the application menu beside the rail, level with the button', () => {
  render(<WorkspaceSidebar />);
  const menu = screen.getByRole('button', { name: 'shell.app_menu' });
  menu.getBoundingClientRect = () => ({ left: 8, right: 48, top: 700, bottom: 740 }) as DOMRect;
  fireEvent.click(menu);
  expect(bridge.popup).toHaveBeenCalledWith({ x: 52, y: 700 });
});

it('leaves the application menu to the system menu bar on macOS', () => {
  bridge.mac = true;
  render(<WorkspaceSidebar />);
  expect(screen.queryByRole('button', { name: 'shell.app_menu' })).toBeNull();
  expect(document.querySelector('[data-slot="rail-app"] a[href="/settings"]')).not.toBeNull();
});

it('uses the plain version label outside development builds', () => {
  expect(versionTranslationKey(true)).toBe('app.version_dev');
  expect(versionTranslationKey(false)).toBe('app.version');
});
