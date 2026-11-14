import type { BrowserWindow, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_MENU_ACTION_CHANNEL,
  APP_MENU_LABELS_CHANNEL,
  APP_MENU_PAGES,
  APP_MENU_PATHS,
  APP_MENU_POPUP_CHANNEL,
  APP_NAVIGATE_CHANNEL,
  englishAppMenuLabels,
} from '../shared/app-menu';
import {
  createApplicationMenuTemplate,
  installAppMenu,
  matchAppMenuShortcut,
  parseAppMenuLabels,
  type AppMenuCommands,
} from './app-menu';

const PLATFORMS = ['darwin', 'win32', 'linux'] as const;

function commands() {
  return {
    navigate: vi.fn<AppMenuCommands['navigate']>(),
    action: vi.fn<AppMenuCommands['action']>(),
    toggleFullScreen: vi.fn<AppMenuCommands['toggleFullScreen']>(),
    toggleMaximize: vi.fn<AppMenuCommands['toggleMaximize']>(),
  };
}

function template(platform: NodeJS.Platform, run = commands()) {
  return createApplicationMenuTemplate({
    labels: englishAppMenuLabels('eVoice Studio'),
    platform,
    commands: run,
  });
}

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

/** What a user can reach: every page, command and role, independent of where it sits. */
function reachable(platform: NodeJS.Platform): string[] {
  return flatten(template(platform))
    .filter((item) => item.type !== 'separator' && !item.submenu)
    .map((item) => item.id ?? `role:${item.role}`)
    .filter(
      (id) =>
        !['role:services', 'role:hide', 'role:hideOthers', 'role:unhide', 'role:front'].includes(
          id,
        ),
    )
    .sort();
}

const press = (
  key: string,
  mods: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {},
) => ({
  type: 'keyDown' as const,
  key,
  control: false,
  meta: false,
  shift: false,
  alt: false,
  isAutoRepeat: false,
  ...mods,
});

describe('createApplicationMenuTemplate', () => {
  it('puts the standard app menu first on macOS only', () => {
    expect(template('darwin').map((item) => item.id)).toEqual([
      'app',
      'file',
      'edit',
      'view',
      'go',
      'window',
      'help',
    ]);
    for (const platform of ['win32', 'linux'] as const)
      expect(template(platform).map((item) => item.id)).toEqual([
        'file',
        'edit',
        'view',
        'go',
        'window',
        'help',
      ]);
    const app = template('darwin')[0]!;
    expect(app.label).toBe('eVoice Studio');
    expect(flatten([app]).map((item) => item.role ?? item.id)).toEqual(
      expect.arrayContaining(['about', 'go:/settings', 'services', 'hide', 'quit']),
    );
  });

  it('offers the same pages and commands on every platform', () => {
    const mac = reachable('darwin');
    for (const platform of PLATFORMS) expect(reachable(platform)).toEqual(mac);
    for (const path of APP_MENU_PATHS) expect(mac).toContain(`go:${path}`);
  });

  it('lists every rail page in the Go menu with its shortcut', () => {
    const go = template('win32').find((item) => item.id === 'go')!;
    const pages = (go.submenu as MenuItemConstructorOptions[]).filter(
      (item) => item.type !== 'separator',
    );
    expect(pages.map((item) => item.id)).toEqual(APP_MENU_PAGES.map((page) => `go:${page.path}`));
    expect(pages.find((item) => item.id === 'go:/music')).toMatchObject({
      label: 'Music Studio',
      accelerator: 'CmdOrCtrl+5',
    });
    const accelerators = flatten(template('darwin'))
      .map((item) => item.accelerator)
      .filter(Boolean);
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });

  it('navigates through the commands when an item is clicked', () => {
    const run = commands();
    const items = flatten(template('linux', run));
    const click = (id: string) => (items.find((item) => item.id === id)!.click as () => void)();
    click('go:/promo');
    click('go:/settings/support');
    click('go:/');
    click('action:command-palette');
    click('action:toggle-full-screen');
    expect(run.navigate.mock.calls).toEqual([['/promo'], ['/settings/support'], ['/']]);
    expect(run.action).toHaveBeenCalledWith('command-palette');
    expect(run.toggleFullScreen).toHaveBeenCalledOnce();
  });

  it('only shows shortcuts on Windows and Linux, where main dispatches them', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const shortcutItems = flatten(template(platform)).filter(
        (item) => item.accelerator || item.role,
      );
      expect(shortcutItems.length).toBeGreaterThan(0);
      for (const item of shortcutItems) expect(item.registerAccelerator).toBe(false);
    }
    for (const item of flatten(template('darwin')))
      expect(item.registerAccelerator).toBeUndefined();
  });

  it('uses the translated labels it is given', () => {
    const labels = { ...englishAppMenuLabels('eVoice Studio'), go: 'Đi tới', '/clone': 'Nhân bản' };
    const built = createApplicationMenuTemplate({
      labels,
      platform: 'win32',
      commands: commands(),
    });
    const go = built.find((item) => item.id === 'go')!;
    expect(go.label).toBe('Đi tới');
    expect((go.submenu as MenuItemConstructorOptions[])[0]!.label).toBe('Nhân bản');
  });
});

describe('matchAppMenuShortcut', () => {
  it('maps Ctrl shortcuts to menu items on Windows and Linux', () => {
    const run = commands();
    const built = template('win32', run);
    expect(matchAppMenuShortcut(built, press('3', { control: true }), 'win32')?.id).toBe('go:/dub');
    expect(
      matchAppMenuShortcut(built, press('H', { control: true, shift: true }), 'win32')?.id,
    ).toBe('go:/');
    expect(matchAppMenuShortcut(built, press('F1'), 'linux')?.id).toBe('go:/settings/support');
    expect(matchAppMenuShortcut(built, press('F11'), 'linux')?.id).toBe(
      'action:toggle-full-screen',
    );
  });

  it('leaves the renderer its own shortcuts, repeats and other keys', () => {
    const built = template('win32');
    expect(matchAppMenuShortcut(built, press(',', { control: true }), 'win32')).toBeNull();
    expect(matchAppMenuShortcut(built, press('k', { control: true }), 'win32')).toBeNull();
    expect(matchAppMenuShortcut(built, press('3'), 'win32')).toBeNull();
    expect(
      matchAppMenuShortcut(built, press('3', { control: true, alt: true }), 'win32'),
    ).toBeNull();
    expect(
      matchAppMenuShortcut(
        built,
        { ...press('3', { control: true }), isAutoRepeat: true },
        'win32',
      ),
    ).toBeNull();
    expect(
      matchAppMenuShortcut(built, { ...press('3', { control: true }), type: 'keyUp' }, 'win32'),
    ).toBeNull();
  });
});

describe('parseAppMenuLabels', () => {
  it('fills missing labels with English and rejects anything unknown or oversized', () => {
    const labels = parseAppMenuLabels({ file: 'Tệp', '/music': 'Âm nhạc' });
    expect(labels.file).toBe('Tệp');
    expect(labels['/music']).toBe('Âm nhạc');
    expect(labels.edit).toBe('Edit');
    expect(labels.about).toBe('About eVoice Studio');
    for (const bad of [
      null,
      [],
      'File',
      { evil: 'x' },
      { file: '' },
      { file: 3 },
      { file: 'x'.repeat(121) },
    ])
      expect(() => parseAppMenuLabels(bad)).toThrow('Invalid labels');
  });
});

describe('installAppMenu', () => {
  function setup(platform: NodeJS.Platform = 'win32') {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>();
    const native = { popup: vi.fn() };
    const menu = {
      buildFromTemplate: vi.fn((_template: MenuItemConstructorOptions[]) => native),
      setApplicationMenu: vi.fn(),
    };
    const send = vi.fn();
    const inputListeners: Array<(event: { preventDefault(): void }, input: unknown) => void> = [];
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      isFullScreen: () => false,
      setFullScreen: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        send,
        on: vi.fn((name: string, listener: (typeof inputListeners)[number]) => {
          if (name === 'before-input-event') inputListeners.push(listener);
        }),
      },
    } as unknown as BrowserWindow;
    const assertTrusted = vi.fn();
    const application = { setAboutPanelOptions: vi.fn() };
    const installed = installAppMenu({
      application,
      menu,
      ipcMain: {
        handle: vi.fn((channel: string, handler: never) => handlers.set(channel, handler)),
        removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      } as never,
      getWindow: () => window,
      assertTrusted,
      version: '0.5.6',
      platform,
    });
    const event = {} as IpcMainInvokeEvent;
    return {
      handlers,
      native,
      menu,
      send,
      window,
      inputListeners,
      assertTrusted,
      application,
      installed,
      event,
    };
  }

  it('installs an English menu at once on every platform and brands About', () => {
    for (const platform of PLATFORMS) {
      const { menu, native, application } = setup(platform);
      expect(menu.setApplicationMenu).toHaveBeenCalledWith(native);
      expect(application.setAboutPanelOptions).toHaveBeenCalledWith({
        applicationName: 'eVoice Studio',
        applicationVersion: '0.5.6',
        version: '0.5.6',
      });
    }
  });

  it('rebuilds the menu with translated labels from the trusted renderer', () => {
    const { handlers, menu, assertTrusted, event } = setup();
    handlers.get(APP_MENU_LABELS_CHANNEL)!(event, { file: 'Tệp' });
    expect(assertTrusted).toHaveBeenCalled();
    const latest = menu.buildFromTemplate.mock.calls.at(-1)![0];
    expect(latest[0]!.label).toBe('Tệp');
    expect(() => handlers.get(APP_MENU_LABELS_CHANNEL)!(event, { nope: 'x' })).toThrow();
  });

  it('refuses label and popup requests from untrusted frames', () => {
    const { handlers, assertTrusted, native, event } = setup();
    assertTrusted.mockImplementation(() => {
      throw new Error('Untrusted main-frame request');
    });
    expect(() => handlers.get(APP_MENU_LABELS_CHANNEL)!(event, { file: 'x' })).toThrow('Untrusted');
    expect(() => handlers.get(APP_MENU_POPUP_CHANNEL)!(event, { x: 1, y: 1 })).toThrow('Untrusted');
    expect(native.popup).not.toHaveBeenCalled();
  });

  it('opens the menu under the button and rejects bad positions', () => {
    const { handlers, native, window, event } = setup();
    handlers.get(APP_MENU_POPUP_CHANNEL)!(event, { x: 10.4, y: 44.6 });
    expect(native.popup).toHaveBeenCalledWith({ window, x: 10, y: 45 });
    for (const bad of [null, { x: '1', y: 2 }, { x: -1, y: 2 }, { x: Number.NaN, y: 2 }, { x: 1 }])
      expect(() => handlers.get(APP_MENU_POPUP_CHANNEL)!(event, bad)).toThrow(
        'Invalid menu position',
      );
  });

  it('sends pages over app:navigate and renderer commands over app-menu:action', () => {
    const { menu, send, window } = setup();
    const items = flatten(menu.buildFromTemplate.mock.calls.at(-1)![0]);
    (items.find((item) => item.id === 'go:/editor')!.click as () => void)();
    (items.find((item) => item.id === 'action:command-palette')!.click as () => void)();
    expect(send.mock.calls).toEqual([
      [APP_NAVIGATE_CHANNEL, '/editor'],
      [APP_MENU_ACTION_CHANNEL, 'command-palette'],
    ]);
    expect(window.show).toHaveBeenCalled();
  });

  it('dispatches shortcuts from the window on Windows and Linux, not on macOS', () => {
    const win = setup('linux');
    win.installed.attach(win.window);
    const preventDefault = vi.fn();
    win.inputListeners[0]!({ preventDefault }, press('7', { control: true }));
    expect(preventDefault).toHaveBeenCalled();
    expect(win.send).toHaveBeenCalledWith(APP_NAVIGATE_CHANNEL, '/editor');

    const mac = setup('darwin');
    mac.installed.attach(mac.window);
    expect(mac.inputListeners).toHaveLength(0);
  });

  it('removes its IPC handlers on dispose', () => {
    const { handlers, installed } = setup();
    installed.dispose();
    expect(handlers.size).toBe(0);
  });
});
