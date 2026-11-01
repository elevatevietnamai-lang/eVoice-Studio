import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

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
vi.mock('@/lib/store/workspace', () => ({ setMenuGroup }));
vi.mock('@/components/bridge', () => ({ appVersion: () => '0.5.7', isMac: () => false }));
vi.mock('@/hooks/use-window-fullscreen', () => ({ useWindowFullscreen: () => false }));
vi.mock('./workspace-menu', () => ({ WorkspaceNavigation: () => <nav /> }));
vi.mock('./status-bar', () => ({ StatusBar: () => null }));
import { versionTranslationKey, WorkspaceSidebar } from './workspace-sidebar';

it('is always the icon rail: no sidebar or panel toggle', () => {
  render(<WorkspaceSidebar />);
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(screen.queryByLabelText('clone.toggle_sidebar')).toBeNull();
  expect(screen.queryByLabelText(/paneActions\./)).toBeNull();
});

it("links the logo Home, named with the app version, drawn with the app icon's own mark", () => {
  render(<WorkspaceSidebar />);
  const logo = screen.getByRole('link', { name: /^app\.name app\.version/ });
  expect(logo).toHaveAttribute('href', '/');
  expect(logo).toHaveClass('size-10');
  const mark = logo.querySelector('svg')!;
  expect(mark).toHaveAttribute('width', '26');
  expect(mark).toHaveAttribute('data-mark', 'full');
});

it('uses the plain version label outside development builds', () => {
  expect(versionTranslationKey(true)).toBe('app.version_dev');
  expect(versionTranslationKey(false)).toBe('app.version');
});
