import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SettingsIcon } from 'lucide-react';
import { EVoiceMark } from '@/components/brand/evoice-mark';
import { appVersion, isMac } from '@/components/bridge';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useWindowFullscreen } from '@/hooks/use-window-fullscreen';
import { setMenuGroup, useMenuGroup } from '@/lib/store/workspace';
import { APP_MENU_HOME_ACCELERATOR, APP_MENU_SETTINGS_ACCELERATOR } from '@shared/app-menu';
import { WorkspaceNavigation } from './workspace-menu';
import { StatusBar } from './status-bar';
import { AppMenuButton } from './app-menu-button';
import { ShellTooltip } from './shell-tooltip';

export function versionTranslationKey(development: boolean) {
  return development ? ('app.version_dev' as const) : ('app.version' as const);
}

/**
 * The icon rail: always this width, never expanded. Group icons open their menu in the panel
 * column beside it; the page's control panel is always open (DESIGN.md).
 */
export function WorkspaceSidebar() {
  const { t } = useTranslation();
  const mac = isMac();
  // Fullscreen hides the traffic lights, so their reserved corner is given back to the brand.
  const trafficLights = mac && !useWindowFullscreen();
  const versionLabel = t(versionTranslationKey(import.meta.env.DEV), {
    version: appVersion(),
  });
  const appLabel = `${t('app.name')} ${versionLabel}`;
  // One lit rail item: an open group menu takes the highlight from the current page.
  const menuOpen = useMenuGroup() !== null;
  return (
    <aside
      aria-label={t('nav.workspaces')}
      data-slot="compact-main-sidebar"
      className={cn(
        'brand-sidebar relative isolate grid h-dvh min-h-0 shrink-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-sidebar',
        mac ? 'w-16' : 'w-14 border-r border-border/50',
      )}
    >
      {mac && (
        <span
          aria-hidden="true"
          data-slot="compact-sidebar-divider"
          className={cn(
            'pointer-events-none absolute right-0 bottom-0 w-px bg-border/50',
            trafficLights ? 'top-[72px]' : 'top-12',
          )}
        />
      )}
      <div
        className={cn(
          'workspace-titlebar flex shrink-0 justify-center',
          trafficLights ? 'min-h-[72px] items-end pb-1' : 'h-12 items-center',
        )}
      >
        {/* The bare mark, no tile and no margin: cropped to its ink box, 32 px tall, white in the
            dark theme and near-black in the light one (`tone="ink"`). The link is exactly the
            mark's size, so nothing pads it. It goes Home. */}
        <ShellTooltip
          side="right"
          label={appLabel}
          hint={t('shell.logo_hint')}
          accelerator={APP_MENU_HOME_ACCELERATOR}
        >
          <Link
            to="/"
            aria-label={appLabel}
            data-slot="rail-logo"
            onClick={() => setMenuGroup(null)}
            // A brand mark, not a control surface: no hover or pressed fill, only the focus ring.
            className="grid size-8 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <EVoiceMark size={32} tone="ink" crop cut="full" className="size-8 shrink-0" />
          </Link>
        </ShellTooltip>
      </div>
      <WorkspaceNavigation />
      {/* The rail's foot, in two groups: system status (speed/quality, engines), then the app
          (the application menu on Windows and Linux, and Settings). */}
      <div className="flex shrink-0 flex-col items-center border-t border-border/50 py-2">
        <div
          role="group"
          aria-label={t('shell.group_system')}
          data-slot="rail-system"
          className="flex flex-col items-center gap-1"
        >
          <StatusBar compact />
        </div>
        <span aria-hidden="true" className="my-1.5 h-px w-6 bg-border/60" />
        <div
          role="group"
          aria-label={t('shell.group_app')}
          data-slot="rail-app"
          className="flex flex-col items-center gap-1"
        >
          <AppMenuButton />
          <ShellTooltip
            side="right"
            label={t('nav.settings')}
            hint={t('shell.settings_hint')}
            accelerator={APP_MENU_SETTINGS_ACCELERATOR}
          >
            <Link
              to="/settings"
              aria-label={t('nav.settings')}
              activeProps={{ 'data-lit': menuOpen ? undefined : 'true' }}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon' }),
                'workspace-nav-item size-10',
              )}
            >
              <SettingsIcon className="workspace-nav-icon size-5" />
            </Link>
          </ShellTooltip>
        </div>
      </div>
    </aside>
  );
}
