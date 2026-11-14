import { MenuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getBridge, isMac } from '@/components/bridge';
import { Button } from '@/components/ui/button';

/**
 * The application menu on Windows and Linux. The window is frameless there, so the OS draws no
 * menu bar; this button opens the same native menu macOS shows in its menu bar, with every page,
 * command and shortcut. Main owns the menu (`src/main/app-menu.ts`); this only asks it to open
 * under the button.
 */
export function AppMenuButton() {
  const { t } = useTranslation();
  const menu = getBridge()?.app?.menu;
  if (!menu || isMac()) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      data-slot="app-menu-button"
      className="app-no-drag shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={t('appMenu.menu')}
      aria-haspopup="menu"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        void menu.popup({ x: box.left, y: box.bottom }).catch(() => {});
      }}
    >
      <MenuIcon className="size-[18px]" aria-hidden="true" />
    </Button>
  );
}
