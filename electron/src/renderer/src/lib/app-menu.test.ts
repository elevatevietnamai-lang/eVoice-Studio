import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_MENU_LABEL_IDS,
  APP_MENU_LABELS,
  APP_MENU_PAGES,
  englishAppMenuLabels,
} from '@shared/app-menu';
import { destinations } from '@/components/app-shell/destinations';
import { setWorkspace } from '@/lib/store/workspace';
import english from '@/i18n/locales/en.json';
import { appMenuLabels, openAppMenuPath } from './app-menu';

const lookup = (key: string) =>
  key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], english);

describe('app menu contract', () => {
  it('lists exactly the rail pages, in the rail order, under the rail names', () => {
    expect(APP_MENU_PAGES.map(({ path, key }) => ({ path, key }))).toEqual(
      destinations.map(({ to, label }) => ({ path: to, key: label })),
    );
  });

  it('keeps the English fallbacks main shows before the renderer loads equal to en.json', () => {
    for (const id of APP_MENU_LABEL_IDS)
      expect(lookup(APP_MENU_LABELS[id].key), id).toBe(APP_MENU_LABELS[id].fallback);
    for (const page of APP_MENU_PAGES) expect(lookup(page.key), page.path).toBe(page.fallback);
  });
});

describe('appMenuLabels', () => {
  it('translates every label and page, filling in the app name', () => {
    const t = vi.fn((key: string, options?: { app?: string }) =>
      key === 'app.name' ? 'eVoice Studio' : `${key}${options?.app ? `:${options.app}` : ''}`,
    ) as unknown as TFunction;
    const labels = appMenuLabels(t);
    expect(Object.keys(labels).sort()).toEqual(
      Object.keys(englishAppMenuLabels('eVoice Studio')).sort(),
    );
    expect(labels.about).toBe('appMenu.about:eVoice Studio');
    expect(labels['/music']).toBe('musicStudio.title');
  });
});

describe('openAppMenuPath', () => {
  it('opens every menu page the way the rail does', () => {
    const navigate = vi.fn();
    setWorkspace({ libraryTab: 'takes' });
    expect(openAppMenuPath('/clone', navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/clone');
    expect(JSON.parse(localStorage.getItem('voicestudio.workspace-layout')!).libraryTab).toBe(
      'voices',
    );
    for (const path of ['/', '/promo', '/editor', '/music', '/settings', '/settings/support']) {
      expect(openAppMenuPath(path, navigate)).toBe(true);
      expect(navigate).toHaveBeenLastCalledWith(path);
    }
  });

  it('ignores paths the menu does not list', () => {
    const navigate = vi.fn();
    for (const path of ['/settings/logs', 'https://example.com', '/../etc', '', 42, null])
      expect(openAppMenuPath(path, navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
