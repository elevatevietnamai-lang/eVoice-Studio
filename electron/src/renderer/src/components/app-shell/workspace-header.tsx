import type { ReactNode } from 'react';
import { CommandSearch } from './command-search';
import { cn } from '@/lib/utils';
import { isMac } from '@/components/bridge';

export function WorkspaceHeader({ children }: { children: ReactNode }) {
  return (
    <header
      className={cn(
        'workspace-titlebar relative flex shrink-0 items-center gap-3 border-b border-border/50 px-5',
        !isMac() && 'native-controls-right',
      )}
    >
      {children}
      <CommandSearch className="ml-auto" />
    </header>
  );
}
