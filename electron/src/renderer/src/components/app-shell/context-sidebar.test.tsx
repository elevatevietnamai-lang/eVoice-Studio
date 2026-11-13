import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/clone' }));
const workspace = vi.hoisted(() => ({ libraryTab: 'voices' as const }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: any) => select({ location: route }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/store/workspace', () => ({
  useWorkspace: () => workspace,
  registerPanel: () => () => {},
}));
vi.mock('@/features/clone/voices-sidebar', () => ({
  VoicesSidebar: () => <div>Voice library</div>,
}));

import { ContextSidebar } from './context-sidebar';

beforeEach(() => {
  route.pathname = '/clone';
});

it('shows the voice library, always open, on the Voice routes only', () => {
  const view = render(<ContextSidebar />);
  expect(screen.getByText('Voice library')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'nav.voice' })).toBeNull();
  route.pathname = '/dub';
  view.rerender(<ContextSidebar />);
  expect(screen.queryByText('Voice library')).toBeNull();
});
