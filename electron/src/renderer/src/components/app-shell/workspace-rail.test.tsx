import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

// The compact rail must be able to reopen the full sidebar on every platform;
// on Windows/Linux it used to show only the brand icon with no control.

const layout = vi.hoisted(() => ({
  state: {
    libraryOpen: false,
    libraryTab: 'voices',
    autoCollapseSidebar: true,
    expandedLibraryContext: null as string | null,
  },
  setWorkspace: vi.fn(),
  panelMounted: false,
}));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: { pathname: '/projects' } }),
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/store/workspace', () => ({
  useWorkspace: () => layout.state,
  setWorkspace: (patch: object) => layout.setWorkspace(patch),
  usePanelMounted: () => layout.panelMounted,
  setMenuGroup: () => {},
}));
vi.mock('@/components/bridge', () => ({ appVersion: () => '0.5.7', isMac: () => false }));
vi.mock('@/lib/brand', () => ({ brandIcon: 'icon.png', brandArtwork: 'art.png' }));
vi.mock('@/hooks/use-pane-resize', () => ({
  usePaneResize: () => ({ host: { current: null }, width: 280, separatorProps: {} }),
}));
vi.mock('@/hooks/use-backend-status', () => ({ useBackendStatus: () => ({ stage: 'ready' }) }));
vi.mock('@/features/clone/voices-sidebar', () => ({ VoicesSidebar: () => <div /> }));
vi.mock('./workspace-menu', () => ({ WorkspaceNavigation: () => <nav /> }));
vi.mock('./status-bar', () => ({ StatusBar: () => null }));
vi.mock('./system-notifications', () => ({ SystemNotifications: () => null }));
import { WorkspaceSidebar } from './workspace-sidebar';

beforeEach(() => {
  layout.setWorkspace.mockClear();
  layout.panelMounted = false;
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
});

it('lets the rail reopen the full sidebar on non-macOS', () => {
  render(<WorkspaceSidebar />);
  fireEvent.click(screen.getByRole('button', { name: 'clone.toggle_sidebar' }));
  expect(layout.setWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ libraryOpen: true, expandedLibraryContext: '/projects:true' }),
  );
});

it('shows the panel toggle only while a page has a control panel', () => {
  const view = render(<WorkspaceSidebar />);
  expect(screen.queryByRole('button', { name: 'paneActions.collapse' })).toBeNull();
  layout.panelMounted = true;
  view.rerender(<WorkspaceSidebar />);
  fireEvent.click(screen.getByRole('button', { name: 'paneActions.collapse' }));
  expect(layout.setWorkspace).toHaveBeenCalledWith({ panelCollapsed: true });
});

it('draws the rail logo as the app icon, as large as the rail items', () => {
  render(<WorkspaceSidebar />);
  const logo = screen.getByRole('button', { name: 'clone.toggle_sidebar' });
  expect(logo).toHaveClass('size-10', 'rounded-[22.6%]');
  expect(logo.querySelector('svg')).toHaveAttribute('width', '32');
});
