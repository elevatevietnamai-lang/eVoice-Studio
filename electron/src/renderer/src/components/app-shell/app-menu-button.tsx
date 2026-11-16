import { MenuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getBridge, isMac } from '@/components/bridge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ShellTooltip } from './shell-tooltip';

/**
 * The application menu on Windows and Linux. The window is frameless there, so the OS draws no
 * menu bar; this button opens the same native menu macOS shows in its menu bar, with every page,
 * command and shortcut. Main owns the menu (`src/main/app-menu.ts`); this only asks it to open
 * beside the button.
 *
 * It lives in the rail's app group, above Settings: it is an app-wide control like Settings, and
 * in the title bar corner it read as a fourth window button next to minimize, maximize and close.
 * On macOS the menu bar is the system's, so the group is Settings alone.
 */
export function AppMenuButton() {
  const { t } = useTranslation();
  const menu = getBridge()?.app?.menu;
  if (!menu || isMac()) return null;
  return (
    <ShellTooltip side="right" label={t('shell.app_menu')} hint={t('shell.app_menu_hint')}>
      <button
        type="button"
        data-slot="app-menu-button"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'workspace-nav-item app-no-drag size-10',
        )}
        aria-label={t('shell.app_menu')}
        aria-haspopup="menu"
        onClick={(event) => {
          // The menu opens to the right of the rail, its top level with the button.
          const box = event.currentTarget.getBoundingClientRect();
          void menu.popup({ x: Math.round(box.right + 4), y: Math.round(box.top) }).catch(() => {});
        }}
      >
        <MenuIcon className="workspace-nav-icon size-5" aria-hidden="true" />
      </button>
    </ShellTooltip>
  );
}
