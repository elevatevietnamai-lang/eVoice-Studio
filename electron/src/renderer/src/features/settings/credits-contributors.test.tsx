import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const browser = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));
const files = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('@/components/bridge', () => ({ getBridge: () => ({ browser, files }) }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-profiles', () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { CreditsContributors } from './credits-contributors';
import { homeContributors } from './credits-contributors-data';

afterEach(cleanup);

it('credits qualifying contributors and opens their GitHub profiles externally', () => {
  render(<CreditsContributors />);
  const credits = screen.getAllByRole('listitem');
  expect(credits).toHaveLength(homeContributors.length + 1);
  expect(
    [1, 2, 3].map((row) => credits.filter((credit) => credit.style.gridRow === String(row)).length),
  ).toEqual([5, 3, 2]);
  expect(homeContributors.every((person) => person.commits > 10)).toBe(true);
  const all = screen.getByRole('link', { name: 'homeUi.allContributors' });
  expect(all).toHaveAttribute(
    'href',
    'https://github.com/debpalash/VoiceStudio/graphs/contributors',
  );
  fireEvent.click(all);
  expect(files.openExternal).toHaveBeenCalledWith(
    'https://github.com/debpalash/VoiceStudio/graphs/contributors',
  );
  for (const { login } of homeContributors) {
    if (login === 'debpalash') continue;
    const profile = screen.getByRole('link', { name: `GitHub · @${login}` });
    expect(profile).toHaveAttribute('href', `https://github.com/${login}`);
    expect(profile.querySelector('img')?.src).not.toMatch(/^https?:\/\/(avatars|github)/);
    fireEvent.click(profile);
    expect(files.openExternal).toHaveBeenCalledWith(`https://github.com/${login}`);
  }
});

it('opens both creator profiles from the accessible avatar card', async () => {
  render(<CreditsContributors />);
  fireEvent.click(screen.getByRole('button', { name: '@debpalash' }));
  const github = await screen.findByRole('link', { name: 'GitHub @debpalash' });
  const x = screen.getByRole('link', { name: 'X @idebpalash' });
  expect(github).toHaveAttribute('href', 'https://github.com/debpalash');
  expect(x).toHaveAttribute('href', 'https://x.com/idebpalash');
  fireEvent.click(github);
  expect(files.openExternal).toHaveBeenCalledWith('https://github.com/debpalash');
  fireEvent.click(x);
  expect(files.openExternal).toHaveBeenCalledWith('https://x.com/idebpalash');
});
