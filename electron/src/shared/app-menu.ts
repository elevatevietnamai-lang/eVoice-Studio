/**
 * The desktop application menu, shared by Electron main (which builds the native menu) and the
 * renderer (which translates its labels and follows its navigation). Main cannot import the
 * renderer catalog, so the renderer sends the translated labels over `APP_MENU_LABELS_CHANNEL`;
 * the English fallbacks here cover the moments before it does and must equal `en.json`
 * (`app-menu-labels.test.ts`).
 */

/** Renderer → main: translated labels, keyed by `AppMenuLabelId`. */
export const APP_MENU_LABELS_CHANNEL = 'app-menu:labels';
/** Renderer → main: open the whole menu at a window point (Windows and Linux menu button). */
export const APP_MENU_POPUP_CHANNEL = 'app-menu:popup';
/** Main → renderer: a menu command the renderer owns (not a page). */
export const APP_MENU_ACTION_CHANNEL = 'app-menu:action';
/** Main → renderer: open a page. The channel the tray already uses. */
export const APP_NAVIGATE_CHANNEL = 'app:navigate';

export type AppMenuAction = 'command-palette';
export const APP_MENU_ACTIONS: readonly AppMenuAction[] = ['command-palette'];

export interface AppMenuPage {
  /** A route the rail or Settings already links; the menu never adds routes. */
  path: string;
  /** i18n key of the name the rail shows for this page. */
  key: string;
  fallback: string;
  /** Electron accelerator. */
  accelerator?: string;
  /** Pages with the same section sit between the same separators in the Go menu. */
  section: number;
}

/**
 * The Go menu: every page of the rail's feature groups, in the rail's order (`destinations.ts`;
 * `app-menu-navigation.test.ts` fails when the two drift). Digits go to the main features.
 */
export const APP_MENU_PAGES: readonly AppMenuPage[] = [
  {
    path: '/clone',
    key: 'nav.clone_short',
    fallback: 'Clone',
    accelerator: 'CmdOrCtrl+1',
    section: 0,
  },
  {
    path: '/design',
    key: 'designWorkspace.title',
    fallback: 'Design',
    accelerator: 'CmdOrCtrl+2',
    section: 0,
  },
  { path: '/personas', key: 'nav.saved', fallback: 'Saved', section: 0 },
  { path: '/gallery', key: 'nav.gallery', fallback: 'Gallery', section: 0 },
  {
    path: '/stories',
    key: 'nav.stories',
    fallback: 'Stories',
    accelerator: 'CmdOrCtrl+8',
    section: 1,
  },
  { path: '/audiobook', key: 'audiobook.title', fallback: 'Audiobook', section: 1 },
  {
    path: '/music',
    key: 'musicStudio.title',
    fallback: 'Music Studio',
    accelerator: 'CmdOrCtrl+5',
    section: 1,
  },
  {
    path: '/dub',
    key: 'dubWorkspace.title',
    fallback: 'Dubbing',
    accelerator: 'CmdOrCtrl+3',
    section: 2,
  },
  {
    path: '/editor',
    key: 'editor.title',
    fallback: 'Video editor',
    accelerator: 'CmdOrCtrl+7',
    section: 2,
  },
  {
    path: '/promo',
    key: 'promo.title',
    fallback: 'Promo video',
    accelerator: 'CmdOrCtrl+6',
    section: 2,
  },
  { path: '/batch', key: 'nav.batch_dub', fallback: 'Batch Dubbing', section: 2 },
  {
    path: '/transcriptions',
    key: 'nav.transcribe',
    fallback: 'Transcribe',
    accelerator: 'CmdOrCtrl+4',
    section: 3,
  },
  { path: '/calls', key: 'workflows.title', fallback: 'Workflows', section: 3 },
  { path: '/tools', key: 'tools.title', fallback: 'Tools', section: 3 },
  { path: '/integrations', key: 'integrationCatalog.title', fallback: 'Integrations', section: 3 },
  {
    path: '/projects',
    key: 'projects.title',
    fallback: 'Projects',
    accelerator: 'CmdOrCtrl+9',
    section: 4,
  },
];

export const APP_MENU_HOME = '/';
export const APP_MENU_SETTINGS = '/settings';
export const APP_MENU_SUPPORT = '/settings/support';

/** Every path the menu may ask the renderer to open. */
export const APP_MENU_PATHS: readonly string[] = [
  APP_MENU_HOME,
  ...APP_MENU_PAGES.map((page) => page.path),
  APP_MENU_SETTINGS,
  APP_MENU_SUPPORT,
];

/** Menu labels other than the pages, with their i18n key and English text. */
export const APP_MENU_LABELS = {
  menu: { key: 'appMenu.menu', fallback: 'Menu' },
  file: { key: 'appMenu.file', fallback: 'File' },
  edit: { key: 'appMenu.edit', fallback: 'Edit' },
  view: { key: 'appMenu.view', fallback: 'View' },
  go: { key: 'appMenu.go', fallback: 'Go' },
  window: { key: 'appMenu.window', fallback: 'Window' },
  help: { key: 'appMenu.help', fallback: 'Help' },
  about: { key: 'appMenu.about', fallback: 'About {{app}}' },
  services: { key: 'appMenu.services', fallback: 'Services' },
  hide: { key: 'appMenu.hide', fallback: 'Hide {{app}}' },
  hideOthers: { key: 'appMenu.hide_others', fallback: 'Hide Others' },
  showAll: { key: 'appMenu.show_all', fallback: 'Show All' },
  quit: { key: 'appMenu.quit', fallback: 'Quit {{app}}' },
  exit: { key: 'appMenu.exit', fallback: 'Exit' },
  closeWindow: { key: 'appMenu.close_window', fallback: 'Close Window' },
  minimize: { key: 'windowControls.minimize', fallback: 'Minimize' },
  maximize: { key: 'windowControls.maximize', fallback: 'Maximize' },
  front: { key: 'appMenu.bring_all_to_front', fallback: 'Bring All to Front' },
  undo: { key: 'appMenu.undo', fallback: 'Undo' },
  redo: { key: 'appMenu.redo', fallback: 'Redo' },
  cut: { key: 'appMenu.cut', fallback: 'Cut' },
  copy: { key: 'appMenu.copy', fallback: 'Copy' },
  paste: { key: 'appMenu.paste', fallback: 'Paste' },
  selectAll: { key: 'appMenu.select_all', fallback: 'Select All' },
  commandPalette: { key: 'appMenu.command_palette', fallback: 'Command Palette…' },
  toggleFullScreen: { key: 'appMenu.toggle_full_screen', fallback: 'Toggle Full Screen' },
  home: { key: 'nav.home', fallback: 'Home' },
  settings: { key: 'appMenu.settings', fallback: 'Settings…' },
  support: { key: 'donate.title', fallback: 'Support' },
} as const;

export type AppMenuLabelId = keyof typeof APP_MENU_LABELS;
export const APP_MENU_LABEL_IDS = Object.keys(APP_MENU_LABELS) as AppMenuLabelId[];

/** Translated labels: every `AppMenuLabelId` plus every page path. */
export type AppMenuLabels = Record<string, string>;

/** Text values may carry `{{app}}`, the product name. */
export function englishAppMenuLabels(app: string): AppMenuLabels {
  const labels: AppMenuLabels = {};
  for (const id of APP_MENU_LABEL_IDS)
    labels[id] = APP_MENU_LABELS[id].fallback.replaceAll('{{app}}', app);
  for (const page of APP_MENU_PAGES) labels[page.path] = page.fallback;
  return labels;
}

/** Shortcuts the renderer already handles itself; the menu only shows them. */
export const RENDERER_OWNED_ACCELERATORS: readonly string[] = ['CmdOrCtrl+,', 'CmdOrCtrl+K'];
