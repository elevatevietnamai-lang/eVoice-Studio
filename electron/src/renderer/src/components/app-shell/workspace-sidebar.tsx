import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PanelLeftCloseIcon, PanelLeftIcon, PanelLeftOpenIcon, SettingsIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EVoiceMark } from '@/components/brand/evoice-mark';
import { appVersion, isMac } from '@/components/bridge';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { usePaneResize } from '@/hooks/use-pane-resize';
import { useWindowFullscreen } from '@/hooks/use-window-fullscreen';
import { setMenuGroup, setWorkspace, usePanelMounted, useWorkspace } from '@/lib/store/workspace';
import { useWorkspaceSidebarState } from './use-workspace-sidebar';
import { WorkspaceNavigation } from './workspace-menu';
import { StatusBar } from './status-bar';

export function versionTranslationKey(development: boolean) {
  return development ? ('app.version_dev' as const) : ('app.version' as const);
}

export function WorkspaceSidebar() {
  const { t } = useTranslation();
  const mac = isMac();
  // Fullscreen hides the traffic lights, so their reserved corner is given back to the brand.
  const trafficLights = mac && !useWindowFullscreen();
  const versionLabel = t(versionTranslationKey(import.meta.env.DEV), {
    version: appVersion(),
  });
  const { libraryOpen, panelCollapsed } = useWorkspace();
  const panelMounted = usePanelMounted();
  // One source of truth for "rail or full sidebar": the header toggle and the
  // sidebar's own buttons used to keep separate copies of this state.
  const { compact, compactViewport, forceExpanded, secondaryWorkspace, setOpen } =
    useWorkspaceSidebarState();
  const sidebarResize = usePaneResize({
    storageKey: 'voicestudio.nav-width',
    side: 'left',
    minimum: 196,
    initial: 216,
    maximum: 288,
    reserve: compactViewport && secondaryWorkspace && forceExpanded ? 520 : 640,
    enabled: libraryOpen,
  });
  return (
    <>
      {compact && (
        <aside
          aria-label={t('clone.saved_profiles')}
          data-slot="compact-main-sidebar"
          onDoubleClick={() => setOpen(true)}
          className={cn(
            'brand-sidebar relative isolate grid h-dvh min-h-0 shrink-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden bg-sidebar',
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
            {/* The rail can always reopen itself, on every platform: the
                brand icon alone gave Windows/Linux no local control. */}
            {/* The app icon as the brand kit draws it (eVoice-brand 2.4): a tile as large as the
                rail items, 22.6% corners, the mark at 80%. */}
            <Button
              variant="default"
              size="icon"
              aria-label={t('clone.toggle_sidebar')}
              title={t('clone.toggle_sidebar')}
              aria-expanded={false}
              data-slot="rail-logo"
              onClick={() => {
                setMenuGroup(null);
                setOpen(true);
              }}
              className="size-10 shrink-0 rounded-[22.6%] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <EVoiceMark size={32} className="size-8 shrink-0" />
            </Button>
          </div>
          <WorkspaceNavigation compact />
          <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border/50 py-2">
            {panelMounted && <PanelToggle collapsed={panelCollapsed} />}
            <StatusBar compact />
            <Link
              to="/settings"
              aria-label={t('nav.settings')}
              title={t('nav.settings')}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon' }),
                'workspace-nav-item size-10',
              )}
            >
              <SettingsIcon className="workspace-nav-icon size-5" />
            </Link>
          </div>
        </aside>
      )}
      {libraryOpen && !compact && (
        <aside
          ref={sidebarResize.host}
          style={{ width: sidebarResize.width }}
          aria-label={t('app.name')}
          className="brand-sidebar relative isolate grid h-full min-h-0 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-border/50 bg-sidebar"
        >
          <header
            className={cn(
              'workspace-titlebar flex shrink-0 gap-2 px-3',
              // The traffic lights get their own row above the brand, so the narrow
              // column never has to reserve their width beside the wordmark.
              trafficLights ? 'min-h-[72px] items-end pb-2' : 'items-center',
            )}
          >
            <Link
              to="/"
              aria-label={`${t('app.name')} ${versionLabel}`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <EVoiceMark size={24} className="shrink-0" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-base font-semibold">{t('app.name')}</span>
                <span className="text-[11px] leading-none text-muted-foreground tabular-nums">
                  {versionLabel}
                </span>
              </span>
            </Link>
          </header>
          <div
            {...sidebarResize.separatorProps}
            aria-label={t('app.name')}
            className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none outline-none hover:bg-primary/15 focus-visible:bg-primary/30"
          />
          {/* Navigation first, like the compact rail: it stays at a fixed
              position under the header instead of riding the library's height. */}
          <div className="min-h-0 min-w-0 overflow-y-auto">
            <WorkspaceNavigation />
          </div>
          <div className="flex min-w-0 shrink-0 flex-col border-t border-border/50">
            <StatusBar
              footerLeading={
                mac ? (
                  <Link
                    to="/settings"
                    aria-label={t('nav.settings')}
                    title={t('nav.settings')}
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
                      'workspace-nav-item',
                    )}
                  >
                    <SettingsIcon className="workspace-nav-icon" />
                  </Link>
                ) : undefined
              }
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
              {!mac && (
                <Link
                  to="/settings"
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'workspace-nav-item',
                  )}
                >
                  <SettingsIcon className="workspace-nav-icon" />
                  {t('nav.settings')}
                </Link>
              )}
              <div className="ml-auto flex items-center gap-1">
                {panelMounted && <PanelToggle collapsed={panelCollapsed} />}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('clone.toggle_sidebar')}
                  title={t('clone.toggle_sidebar')}
                  aria-expanded
                  onClick={() => setOpen(false)}
                >
                  <PanelLeftIcon className="size-5" />
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}

/** Folds or reopens the current page's control panel; the only toggle for it (DESIGN.md). */
function PanelToggle({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const label = t(collapsed ? 'paneActions.expand' : 'paneActions.collapse');
  const Icon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-expanded={!collapsed}
            onClick={() => {
              setMenuGroup(null);
              setWorkspace({ panelCollapsed: !collapsed });
            }}
            className="workspace-nav-item size-10"
          />
        }
      >
        <Icon className="workspace-nav-icon size-5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
