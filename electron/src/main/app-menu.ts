import type {
  AboutPanelOptionsOptions,
  BrowserWindow,
  Input,
  IpcMain,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  PopupOptions,
} from 'electron';
import {
  APP_MENU_ACTION_CHANNEL,
  APP_MENU_HOME,
  APP_MENU_LABEL_IDS,
  APP_MENU_LABELS_CHANNEL,
  APP_MENU_PAGES,
  APP_MENU_POPUP_CHANNEL,
  APP_MENU_SETTINGS,
  APP_MENU_SUPPORT,
  APP_NAVIGATE_CHANNEL,
  RENDERER_OWNED_ACCELERATORS,
  englishAppMenuLabels,
  type AppMenuAction,
  type AppMenuLabels,
} from '../shared/app-menu';
import { DESKTOP_APP_NAME } from './app-identity';
import { activateLiveWindow, sendToLiveWindow } from './window-safety';

export const HOME_ACCELERATOR = 'CmdOrCtrl+Shift+H';
export const SUPPORT_ACCELERATOR = 'F1';

export interface AppMenuCommands {
  navigate(path: string): void;
  action(action: AppMenuAction): void;
  toggleFullScreen(): void;
  toggleMaximize(): void;
}

export interface AppMenuOptions {
  labels: AppMenuLabels;
  platform: NodeJS.Platform;
  commands: AppMenuCommands;
}

/**
 * One template for every platform: macOS puts the app's own items in the standard application
 * menu, Windows and Linux put Settings and Exit in File. Every page and command is in both.
 */
export function createApplicationMenuTemplate({
  labels,
  platform,
  commands,
}: AppMenuOptions): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  // Windows and Linux dispatch shortcuts in `matchAppMenuShortcut` (the frameless window has no
  // visible menu bar to own them); the menu only shows them, so nothing fires twice.
  const shortcut = (accelerator: string): Partial<MenuItemConstructorOptions> => ({
    accelerator,
    ...(mac ? {} : { registerAccelerator: false }),
  });
  const role = (
    value: NonNullable<MenuItemConstructorOptions['role']>,
    label: string,
  ): MenuItemConstructorOptions => ({
    role: value,
    label,
    ...(mac ? {} : { registerAccelerator: false }),
  });
  const page = (path: string, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id: `go:${path}`,
    label,
    ...(accelerator ? shortcut(accelerator) : {}),
    click: () => commands.navigate(path),
  });
  const settings: MenuItemConstructorOptions = {
    ...page(APP_MENU_SETTINGS, labels.settings!, 'CmdOrCtrl+,'),
  };
  const separator: MenuItemConstructorOptions = { type: 'separator' };

  const goItems: MenuItemConstructorOptions[] = [];
  APP_MENU_PAGES.forEach((entry, index) => {
    if (index > 0 && APP_MENU_PAGES[index - 1]!.section !== entry.section) goItems.push(separator);
    goItems.push(page(entry.path, labels[entry.path]!, entry.accelerator));
  });

  const template: MenuItemConstructorOptions[] = [];
  if (mac)
    template.push({
      id: 'app',
      label: DESKTOP_APP_NAME,
      submenu: [
        { role: 'about', label: labels.about },
        separator,
        settings,
        separator,
        { role: 'services', label: labels.services },
        separator,
        { role: 'hide', label: labels.hide },
        { role: 'hideOthers', label: labels.hideOthers },
        { role: 'unhide', label: labels.showAll },
        separator,
        { role: 'quit', label: labels.quit },
      ],
    });
  template.push(
    {
      id: 'file',
      label: labels.file,
      submenu: [
        page(APP_MENU_HOME, labels.home!, HOME_ACCELERATOR),
        separator,
        ...(mac
          ? [role('close', labels.closeWindow!)]
          : [settings, separator, role('quit', labels.exit!)]),
      ],
    },
    {
      id: 'edit',
      label: labels.edit,
      submenu: [
        role('undo', labels.undo!),
        role('redo', labels.redo!),
        separator,
        role('cut', labels.cut!),
        role('copy', labels.copy!),
        role('paste', labels.paste!),
        separator,
        role('selectAll', labels.selectAll!),
      ],
    },
    {
      id: 'view',
      label: labels.view,
      submenu: [
        {
          id: 'action:command-palette',
          label: labels.commandPalette,
          ...shortcut('CmdOrCtrl+K'),
          click: () => commands.action('command-palette'),
        },
        separator,
        {
          id: 'action:toggle-full-screen',
          label: labels.toggleFullScreen,
          ...shortcut(mac ? 'Ctrl+Command+F' : 'F11'),
          click: () => commands.toggleFullScreen(),
        },
      ],
    },
    { id: 'go', label: labels.go, submenu: goItems },
    {
      id: 'window',
      label: labels.window,
      submenu: [
        role('minimize', labels.minimize!),
        {
          id: 'action:toggle-maximize',
          label: labels.maximize,
          click: () => commands.toggleMaximize(),
        },
        ...(mac ? [separator, role('front', labels.front!)] : [role('close', labels.closeWindow!)]),
      ],
    },
    {
      id: 'help',
      label: labels.help,
      submenu: [
        page(APP_MENU_SUPPORT, labels.support!, SUPPORT_ACCELERATOR),
        ...(mac ? [] : [separator, role('about', labels.about!)]),
      ],
    },
  );
  return template;
}

/** Normalizes an accelerator for comparison: `CmdOrCtrl+Shift+H` → `ctrl+shift+h`. */
function normalize(accelerator: string, mac: boolean): string {
  const parts = accelerator.toLowerCase().split('+');
  const key = parts.pop()!;
  const mods = new Set(
    parts.map((part) =>
      part === 'cmdorctrl' || part === 'commandorcontrol'
        ? mac
          ? 'meta'
          : 'ctrl'
        : part === 'command' || part === 'cmd'
          ? 'meta'
          : part === 'control'
            ? 'ctrl'
            : part === 'option'
              ? 'alt'
              : part,
    ),
  );
  return [...['ctrl', 'meta', 'alt', 'shift'].filter((mod) => mods.has(mod)), key].join('+');
}

function inputAccelerator(
  input: Pick<Input, 'key' | 'control' | 'meta' | 'alt' | 'shift'>,
): string {
  const mods = [
    input.control && 'ctrl',
    input.meta && 'meta',
    input.alt && 'alt',
    input.shift && 'shift',
  ].filter(Boolean);
  return [...mods, input.key.toLowerCase()].join('+');
}

/**
 * The menu item a key press triggers on Windows and Linux, or null. Shortcuts the renderer already
 * handles (Settings, the command palette) are left to it.
 */
export function matchAppMenuShortcut(
  template: MenuItemConstructorOptions[],
  input: Pick<Input, 'type' | 'key' | 'control' | 'meta' | 'alt' | 'shift' | 'isAutoRepeat'>,
  platform: NodeJS.Platform,
): MenuItemConstructorOptions | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  const mac = platform === 'darwin';
  const pressed = inputAccelerator(input);
  const owned = new Set(RENDERER_OWNED_ACCELERATORS.map((value) => normalize(value, mac)));
  const visit = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions | null => {
    for (const item of items) {
      if (Array.isArray(item.submenu)) {
        const found = visit(item.submenu);
        if (found) return found;
      }
      if (typeof item.accelerator !== 'string' || !item.click) continue;
      const wanted = normalize(item.accelerator, mac);
      if (wanted === pressed && !owned.has(wanted)) return item;
    }
    return null;
  };
  return visit(template);
}

const MAX_LABEL_LENGTH = 120;

/** Accepts only known label ids with short, non-empty text; anything else is an error. */
export function parseAppMenuLabels(input: unknown): AppMenuLabels {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid labels');
  const known = new Set<string>([
    ...APP_MENU_LABEL_IDS,
    ...APP_MENU_PAGES.map((page) => page.path),
  ]);
  const labels = englishAppMenuLabels(DESKTOP_APP_NAME);
  for (const [id, value] of Object.entries(input)) {
    if (!known.has(id)) throw new Error('Invalid labels');
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_LABEL_LENGTH)
      throw new Error('Invalid labels');
    labels[id] = value;
  }
  return labels;
}

function parsePopupPoint(input: unknown): { x: number; y: number } {
  const point = input as { x?: unknown; y?: unknown } | null;
  const x = point?.x;
  const y = point?.y;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > 100_000 ||
    y > 100_000
  )
    throw new Error('Invalid menu position');
  return { x: Math.round(x), y: Math.round(y) };
}

interface NativeMenu {
  popup(options?: PopupOptions): void;
}

export interface MenuApi<TMenu extends NativeMenu> {
  buildFromTemplate(template: MenuItemConstructorOptions[]): TMenu;
  setApplicationMenu(menu: TMenu | null): void;
}

export interface InstallAppMenuOptions<TMenu extends NativeMenu> {
  application: { setAboutPanelOptions(options: AboutPanelOptionsOptions): void };
  menu: MenuApi<TMenu>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  getWindow: () => BrowserWindow | null;
  assertTrusted: (event: IpcMainInvokeEvent, owner: BrowserWindow | null) => void;
  version: string;
  platform: NodeJS.Platform;
}

/**
 * Installs the application menu on every platform and the IPC it needs. Menu commands reach the
 * renderer over `app:navigate` (pages) or `app-menu:action` (renderer commands).
 */
export function installAppMenu<TMenu extends NativeMenu>({
  application,
  menu,
  ipcMain,
  getWindow,
  assertTrusted,
  version,
  platform,
}: InstallAppMenuOptions<TMenu>): {
  attach(window: BrowserWindow): void;
  dispose(): void;
} {
  application.setAboutPanelOptions({
    applicationName: DESKTOP_APP_NAME,
    applicationVersion: version,
    version,
  });
  const live = () => {
    const owner = getWindow();
    return activateLiveWindow(owner) ? owner : null;
  };
  const commands: AppMenuCommands = {
    navigate: (path) => {
      const owner = live();
      if (owner) sendToLiveWindow(owner, APP_NAVIGATE_CHANNEL, path);
    },
    action: (action) => {
      const owner = live();
      if (owner) sendToLiveWindow(owner, APP_MENU_ACTION_CHANNEL, action);
    },
    toggleFullScreen: () => {
      const owner = live();
      if (owner) owner.setFullScreen(!owner.isFullScreen());
    },
    toggleMaximize: () => {
      const owner = live();
      if (!owner) return;
      if (owner.isMaximized()) owner.unmaximize();
      else owner.maximize();
    },
  };
  let template: MenuItemConstructorOptions[] = [];
  let native: TMenu | null = null;
  const install = (labels: AppMenuLabels) => {
    template = createApplicationMenuTemplate({ labels, platform, commands });
    native = menu.buildFromTemplate(template);
    menu.setApplicationMenu(native);
  };
  install(englishAppMenuLabels(DESKTOP_APP_NAME));

  ipcMain.handle(APP_MENU_LABELS_CHANNEL, (event, input: unknown) => {
    assertTrusted(event, getWindow());
    install(parseAppMenuLabels(input));
  });
  ipcMain.handle(APP_MENU_POPUP_CHANNEL, (event, input: unknown) => {
    const owner = getWindow();
    assertTrusted(event, owner);
    const { x, y } = parsePopupPoint(input);
    native?.popup({ window: owner!, x, y });
  });

  return {
    attach(window) {
      if (platform === 'darwin') return;
      window.webContents.on('before-input-event', (event, input) => {
        const item = matchAppMenuShortcut(template, input, platform);
        if (!item?.click) return;
        event.preventDefault();
        (item.click as () => void)();
      });
    },
    dispose() {
      ipcMain.removeHandler(APP_MENU_LABELS_CHANNEL);
      ipcMain.removeHandler(APP_MENU_POPUP_CHANNEL);
    },
  };
}
