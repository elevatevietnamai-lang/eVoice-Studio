import { join } from 'node:path';
import type { App } from 'electron';
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
