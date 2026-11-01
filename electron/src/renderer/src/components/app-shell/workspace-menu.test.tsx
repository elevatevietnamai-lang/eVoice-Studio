import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

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
vi.mock('@/lib/store/workspace', () => ({ setWorkspace }));
import { WorkspaceNavigation } from './workspace-menu';

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

it('keeps grouped destinations reachable from the compact rail', async () => {
  render(<WorkspaceNavigation compact />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  expect(await screen.findByRole('link', { name: 'nav.clone_short' })).toHaveAttribute(
    'href',
    '/clone',
  );
  expect(screen.getByRole('link', { name: 'nav.gallery' })).toHaveAttribute('href', '/gallery');
});

it('names a compact group on hover and opens its menu only on click', async () => {
  render(<WorkspaceNavigation compact />);
  const voice = screen.getByRole('button', { name: 'nav.voice' });
  fireEvent.pointerEnter(voice, { pointerType: 'mouse' });
  fireEvent.mouseEnter(voice);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByRole('link', { name: 'nav.clone_short' })).toBeNull();
  fireEvent.click(voice);
  expect(await screen.findByRole('link', { name: 'nav.clone_short' })).toBeInTheDocument();
  expect(voice).toHaveAttribute('aria-expanded', 'true');
});

it('closes the menu and opens the page panel when an item is chosen', async () => {
  route.pathname = '/gallery';
  render(<WorkspaceNavigation compact />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(await screen.findByRole('link', { name: 'nav.clone_short' }));
  expect(setWorkspace).toHaveBeenCalledWith({ panelCollapsed: false });
  await waitFor(() => expect(screen.queryByRole('link', { name: 'nav.clone_short' })).toBeNull());
});

it('closes the compact flyout when choosing the current route again', async () => {
  route.pathname = '/gallery';
  render(<WorkspaceNavigation compact />);
  fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
  fireEvent.click(await screen.findByRole('link', { name: 'nav.gallery' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'nav.gallery' })).toBeNull());
});
