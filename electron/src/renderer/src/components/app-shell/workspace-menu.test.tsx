import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/gallery' }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: route }),
  // Active when `to` is the current route, like the real Link.
  Link: ({ to, activeProps, children, ...props }: any) => {
    const { className: activeClass, ...activeAttrs } =
      to === route.pathname ? (activeProps ?? {}) : {};
    return (
      <a href={to} {...props} {...activeAttrs} className={[props.className, activeClass].join(' ')}>
        {children}
      </a>
    );
  },
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
      <WorkspaceNavigation />
      <GroupMenuPanel />
    </>
  );
}

afterEach(() => {
  cleanup();
  act(() => setMenuGroup(null));
  setWorkspace.mockClear();
});

it('opens a rail group as a menu in the panel column, and closes it on a second click', async () => {
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
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull(),
  );
});

it('switches the menu to another group', async () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'nav.dub' }));
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull(),
  );
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
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull(),
  );
});

it('gives the column back to the page panel when a page is chosen, even the current one', async () => {
  route.pathname = '/gallery';
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(screen.getByRole('link', { name: /nav\.gallery/ }));

  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull(),
  );
});

it('closes on Escape and returns focus to the rail button', async () => {
  render(<Shell />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  fireEvent.click(voice);
  fireEvent.keyDown(screen.getByRole('complementary', { name: 'nav.voice' }), { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.voice' })).toBeNull(),
  );
  expect(voice).toHaveFocus();
});

it('closes when the route changes', async () => {
  route.pathname = '/gallery';
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.stories' }));
  route.pathname = '/music';
  view.rerender(<Shell />);
  await waitFor(() =>
    expect(screen.queryByRole('complementary', { name: 'nav.stories' })).toBeNull(),
  );
});

it('shows an opaque menu surface from the first frame, with no fade on the surface itself', async () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  const menu = screen.getByRole('complementary', { name: 'nav.voice' });
  expect(menu.className).not.toMatch(/animate-|fade-|opacity-/);
  expect(menu).toHaveClass('bg-sidebar');
});

it('lights one rail item: the open menu group, not the current page', () => {
  route.pathname = '/projects';
  render(<Shell />);
  const lit = () =>
    Array.from(document.querySelectorAll('[data-slot="workspace-navigation"] [data-lit="true"]'));
  const projects = screen.getByRole('link', { name: 'projects.title' });
  expect(lit()).toEqual([projects]);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  fireEvent.click(voice);
  expect(lit()).toEqual([voice]);
  expect(projects.className).not.toMatch(/sidebar-row-selected/);
  expect(projects).toHaveAttribute('aria-current', 'page');
});
