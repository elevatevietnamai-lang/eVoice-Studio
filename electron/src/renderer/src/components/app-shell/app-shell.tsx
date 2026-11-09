import { WorkspaceSidebar } from './workspace-sidebar';
import { ContextSidebar } from './context-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { BackendGate } from '../backend-gate';
import { RepairAgentDock } from './repair-agent-dock';
import { isMac } from '../bridge';
import { cn } from '@/lib/utils';
import { useBackendStatus } from '@/hooks/use-backend-status';
import { isBackendReachable } from '@shared/utils/backendStage';
import { AccountCorner } from './account-corner';
import { RouteFade } from '@/components/motion';
import { useEffect, useState } from 'react';
import { setWorkspace, useWorkspace } from '@/lib/store/workspace';
import { PanelSlotContext } from '@/components/panel-slot-context';
import { PanelColumn } from './panel-slot';

export function AppShell() {
  const backend = useBackendStatus();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const segment = pathname.split('/')[1] ?? '';
  const { panelCollapsed } = useWorkspace();
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  // Every way into a page (menu, Home card, search) shows its control panel open.
  useEffect(() => {
    if (panelCollapsed) setWorkspace({ panelCollapsed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  const shellOnly = pathname.startsWith('/settings') || pathname === '/pro';
  const macWorkspace = isMac() && !shellOnly;
  const SettingsWorkspace = pathname === '/settings/openapi' ? 'div' : 'main';
  return (
    <div
      className={cn(
        'app-surface relative flex h-full flex-col bg-background text-foreground',
        macWorkspace && 'macos-notification-safe-area',
      )}
    >
      <PanelSlotContext.Provider value={panelSlot}>
        <div className="flex min-h-0 flex-1">
          {shellOnly ? (
            <>
              <CommandPalette />
              {/* The main sidebar (navigation, library, status) stays where it is
                on Settings too, so the app never swaps its left column. */}
              <WorkspaceSidebar />
              <PanelColumn onSlot={setPanelSlot} />
              <SettingsWorkspace
                data-slot="workspace-content"
                role={pathname === '/settings/openapi' ? 'main' : undefined}
                className="@container relative flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                <div className="min-h-0 flex-1 overflow-hidden">
                  <RouteFade segment={segment}>
                    <Outlet />
                  </RouteFade>
                </div>
                <RepairAgentDock />
              </SettingsWorkspace>
            </>
          ) : (
            <BackendGate repairDock={<RepairAgentDock />}>
              <CommandPalette />
              <WorkspaceSidebar />
              <ContextSidebar />
              <PanelColumn onSlot={setPanelSlot} />
              <main
                data-slot="workspace-content"
                className="@container relative flex min-w-0 flex-1 flex-col overflow-hidden"
              >
                <div className="min-h-0 flex-1 overflow-hidden">
                  <RouteFade segment={segment}>
                    <Outlet />
                  </RouteFade>
                </div>
                <RepairAgentDock />
              </main>
            </BackendGate>
          )}
        </div>
      </PanelSlotContext.Provider>
      {/* Native drag-region hit testing follows document order. Keep these
          no-drag controls after every workspace titlebar, outside BackendGate. */}
      {/* Top-right corner on every page and platform: account, then the notifications bell. */}
      <AccountCorner notificationsEnabled={isBackendReachable(backend.stage)} />
    </div>
  );
}
