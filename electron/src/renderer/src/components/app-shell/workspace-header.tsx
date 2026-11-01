import type { ReactNode } from 'react';
import { CommandSearch } from './command-search';
import { cn } from '@/lib/utils';
import { isMac } from '@/components/bridge';
import { usePanelMounted } from '@/lib/store/workspace';

export function WorkspaceHeader({ children }: { children: ReactNode }) {
  // A page with a control panel already names itself at the top of the panel column, so its
  // heading stays for screen readers only and the page title is shown once.
  const panelMounted = usePanelMounted();
  return (
    <header
      className={cn(
        'workspace-titlebar relative flex shrink-0 items-center gap-3 border-b border-border/50 px-5',
        !isMac() && 'native-controls-right',
        panelMounted && '[&>h1]:sr-only',
      )}
    >
      {children}
      <CommandSearch className="ml-auto" />
    </header>
  );
}
