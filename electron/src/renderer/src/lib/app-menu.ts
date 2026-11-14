import type { TFunction } from 'i18next';
import {
  APP_MENU_LABEL_IDS,
  APP_MENU_LABELS,
  APP_MENU_PAGES,
  APP_MENU_PATHS,
  type AppMenuLabels,
} from '@shared/app-menu';
import { destinations } from '@/components/app-shell/destinations';

/** The native menu's labels in the current language, for `app.menu.setLabels`. */
export function appMenuLabels(t: TFunction): AppMenuLabels {
  const app = t('app.name');
  const labels: AppMenuLabels = {};
  for (const id of APP_MENU_LABEL_IDS) labels[id] = t(APP_MENU_LABELS[id].key, { app });
  for (const page of APP_MENU_PAGES) labels[page.path] = t(page.key);
  return labels;
}

/**
 * Follows a page the native menu (or the tray) asked for, the way the rail does: the page's own
 * `activate` runs first (Clone and Saved open the saved-voices tab). Paths the menu does not list
 * are ignored, so the channel cannot open arbitrary routes.
 */
export function openAppMenuPath(path: unknown, navigate: (to: string) => unknown): boolean {
  if (typeof path !== 'string' || !APP_MENU_PATHS.includes(path)) return false;
  destinations.find((destination) => destination.to === path)?.activate?.();
  void navigate(path);
  return true;
}
