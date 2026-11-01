import { cleanup, render, screen } from '@testing-library/react';
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
import { HomePage } from './home-page';
import en from '@/i18n/locales/en.json';

afterEach(cleanup);

it('presents the eVoice Studio hero with the tagline and no upstream link', () => {
  render(<HomePage />);
  const heading = screen.getByRole('heading', { name: 'eVoice Studio' });
  expect(screen.getByText('homeUi.subtitle')).toBeInTheDocument();
  expect(heading.closest('section')?.querySelector('[data-mark]')).not.toBeNull();
  expect(document.querySelector('a[href^="http"]')).toBeNull();
  expect(en.homeUi.subtitle).toBe('A local studio for voice and music.');
});

it('uses no Tailwind hue classes or hard-coded hex colours in the Home sources', () => {
  const sources = import.meta.glob('./*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const hue = /(?:bg|text|ring|border|from|to|via)-(?:sky|violet|teal|rose|amber|fuchsia|cyan|indigo|slate|blue|green|red|purple|pink|orange|yellow)-\d/;
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('.test.tsx')) continue;
    expect(source, file).not.toMatch(hue);
    expect(source, file).not.toMatch(/#[0-9a-fA-F]{6}/);
  }
});

it('names the feature Dubbing consistently while preserving the existing route', () => {
  expect(en.dubWorkspace.title).toBe('Dubbing');
  expect(en.nav.dub).toBe('Dubbing');
  expect(en.keyboard.dub).toBe('Dubbing');
  render(<HomePage />);
  expect(screen.getByRole('link', { name: /dubWorkspace.title/ })).toHaveAttribute('href', '/dub');
});

it('separates three primary creation actions and describes all ten destinations', () => {
  render(<HomePage />);
  const clone = screen.getByRole('link', { name: /nav.clone/ });
  const primary = clone.closest('.home-destinations')!;
  expect(Array.from(primary.querySelectorAll('a'), (a) => a.getAttribute('href'))).toEqual([
    '/clone',
    '/design',
    '/dub',
  ]);
  expect(primary.nextElementSibling?.querySelectorAll('a')).toHaveLength(7);
  const icons = document.querySelectorAll('svg.home-feature-svg');
  expect(icons).toHaveLength(10);
  icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  for (const key of ['design', 'dub', 'stories', 'audiobook', 'transcribe']) {
    expect(screen.getByText('homeUi.' + key)).toBeInTheDocument();
  }
  expect(screen.queryByText('demo.dictation_lede')).not.toBeInTheDocument();
  expect(screen.queryByText('dub.supported_formats')).not.toBeInTheDocument();
  expect(screen.queryByText('clone.history_title')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
