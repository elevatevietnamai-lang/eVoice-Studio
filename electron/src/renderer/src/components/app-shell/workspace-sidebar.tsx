import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SettingsIcon } from 'lucide-react';
import { EVoiceMark } from '@/components/brand/evoice-mark';
import { appVersion, isMac } from '@/components/bridge';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useWindowFullscreen } from '@/hooks/use-window-fullscreen';
import { setMenuGroup, useMenuGroup } from '@/lib/store/workspace';
import { WorkspaceNavigation } from './workspace-menu';
import { StatusBar } from './status-bar';

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
        {/* The app's mark in its brand colours, no tile. 26 px: the bars are tall (ink is 91% of
            the box), so this sits about 24 px high, a step above the 20 px menu icons without
            filling the 40 px button. It goes Home. */}
        <Link
          to="/"
          aria-label={appLabel}
          title={appLabel}
          data-slot="rail-logo"
          onClick={() => setMenuGroup(null)}
          // A brand mark, not a control surface: no hover or pressed fill, only the focus ring.
          className="grid size-10 shrink-0 place-items-center rounded-lg text-sidebar-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <EVoiceMark size={26} cut="full" className="size-[26px] shrink-0" />
        </Link>
      </div>
      <WorkspaceNavigation />
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border/50 py-2">
        <StatusBar compact />
        <Link
          to="/settings"
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          activeProps={{ 'data-lit': menuOpen ? undefined : 'true' }}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            'workspace-nav-item size-10',
          )}
        >
          <SettingsIcon className="workspace-nav-icon size-5" />
        </Link>
      </div>
    </aside>
  );
}
