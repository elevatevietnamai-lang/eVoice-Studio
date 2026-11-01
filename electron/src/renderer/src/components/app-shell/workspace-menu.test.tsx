import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/gallery' }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: route }),
  Link: ({ to, activeProps: _activeProps, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setWorkspace = vi.hoisted(() => vi.fn());
vi.mock('@/lib/store/workspace', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/store/workspace')>()),
  setWorkspace,
}));
import { setMenuGroup } from '@/lib/store/workspace';
import { GroupMenuPanel, WorkspaceNavigation } from './workspace-menu';

/** The rail and the panel column, as the shell lays them out. */
function Shell() {
  return (
    <>
      <WorkspaceNavigation compact />
      <GroupMenuPanel />
    </>
  );
}

afterEach(() => {
  cleanup();
  act(() => setMenuGroup(null));
  setWorkspace.mockClear();
});

it('opens the current workflow, lets users collapse it, and follows route changes', () => {
  const { rerender } = render(<WorkspaceNavigation />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  expect(voice).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: 'nav.gallery' })).toHaveAttribute('href', '/gallery');
  const more = screen.getByRole('button', { name: 'nav.more' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  expect(screen.getByRole('link', { name: 'workflows.title' })).toHaveAttribute('href', '/calls');
  fireEvent.click(voice);
  expect(voice).toHaveAttribute('aria-expanded', 'false');
  route.pathname = '/audiobook';
  rerender(<WorkspaceNavigation />);
  expect(screen.getByRole('button', { name: 'nav.stories' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('link', { name: 'audiobook.title' })).toHaveAttribute(
    'href',
    '/audiobook',
  );
});

it('opens a rail group as a menu in the panel column, and closes it on a second click', () => {
  render(<Shell />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  expect(screen.queryByRole('link', { name: 'nav.clone_short' })).toBeNull();
  fireEvent.click(voice);
  expect(voice).toHaveAttribute('aria-expanded', 'true');
  const menu = screen.getByRole('complementary', { name: 'nav.voice' });
  expect(menu).toHaveAttribute('data-slot', 'group-menu');
  expect(within(menu).getByRole('link', { name: /nav\.clone_short/ })).toHaveAttribute(
    'href',
    '/clone',
  );
  fireEvent.click(voice);
  expect(voice).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull();
});

it('switches the menu to another group', () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'nav.dub' }));
  expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull();
  const menu = screen.getByRole('complementary', { name: 'nav.dub' });
  expect(within(menu).getByRole('link', { name: /nav\.batch_dub/ })).toHaveAttribute(
    'href',
    '/batch',
  );
});

it('names a rail group on hover without opening its menu', async () => {
  render(<Shell />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  fireEvent.pointerEnter(voice, { pointerType: 'mouse' });
  fireEvent.mouseEnter(voice);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull();
});

it('gives the column back to the page panel when a page is chosen, even the current one', () => {
  route.pathname = '/gallery';
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(screen.getByRole('link', { name: /nav\.gallery/ }));
  expect(setWorkspace).toHaveBeenCalledWith({ panelCollapsed: false });
  expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull();
});

it('closes on Escape and returns focus to the rail button', () => {
  render(<Shell />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  fireEvent.click(voice);
  fireEvent.keyDown(screen.getByRole('complementary', { name: 'nav.voice' }), { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull();
  expect(voice).toHaveFocus();
});

it('closes when the route changes', () => {
  route.pathname = '/gallery';
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.stories' }));
  route.pathname = '/music';
  view.rerender(<Shell />);
  expect(screen.queryByRole('complementary', { name: 'nav.stories' })).toBeNull();
});

it('shows an opaque menu surface from the first frame, with no fade on the surface itself', () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  const menu = screen.getByRole('complementary', { name: 'nav.voice' });
  expect(menu.className).not.toMatch(/animate-|fade-|opacity-/);
  expect(menu).toHaveClass('bg-sidebar');
});
