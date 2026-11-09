import { join } from 'node:path';
import type { AboutPanelOptionsOptions, App, MenuItemConstructorOptions } from 'electron';
import { PRODUCT_NAME } from '../../../config/app-config.mjs';

export const DESKTOP_APP_NAME = PRODUCT_NAME;

/**
 * The data folder keeps the name existing installations already use. Electron derives it from the
 * app name, so renaming the product would otherwise orphan settings and the installed runtime.
 */
export const USER_DATA_DIR_NAME = 'VoiceStudio';

/**
 * Set before Electron creates the native application menu. An explicit `--user-data-dir` (tests,
 * portable launches) already chose the profile, so the legacy folder name must not override it.
 */
export function installAppIdentity(
  application: Pick<App, 'setName' | 'setPath' | 'getPath'> & {
    commandLine?: Pick<App['commandLine'], 'hasSwitch'>;
  },
): void {
  application.setName(DESKTOP_APP_NAME);
  if (application.commandLine?.hasSwitch('user-data-dir')) return;
  application.setPath('userData', join(application.getPath('appData'), USER_DATA_DIR_NAME));
}

export function createMacApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: DESKTOP_APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

interface AboutApplication {
  setAboutPanelOptions(options: AboutPanelOptionsOptions): void;
}

interface ApplicationMenuInstaller<TMenu> {
  buildFromTemplate(template: MenuItemConstructorOptions[]): TMenu;
  setApplicationMenu(menu: TMenu): void;
}

export function installMacApplicationMenu<TMenu>(
  application: AboutApplication,
  menu: ApplicationMenuInstaller<TMenu>,
  version: string,
): void {
  application.setAboutPanelOptions({
    applicationName: DESKTOP_APP_NAME,
    applicationVersion: version,
    version,
  });
  menu.setApplicationMenu(menu.buildFromTemplate(createMacApplicationMenuTemplate()));
}
