import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CommandSearch } from './command-search';
import { cn } from '@/lib/utils';
import { isMac } from '@/components/bridge';
import { usePanelTitles } from '@/lib/store/workspace';

export function WorkspaceHeader({ children }: { children: ReactNode }) {
  // When the page's own panel already shows this heading at the top of the panel column, the
  // heading stays for screen readers only, so the page is named once. Other panels (the voice
  // library beside Home) leave it visible.
  const titles = usePanelTitles();
  const header = useRef<HTMLElement>(null);
  const [named, setNamed] = useState(false);
  useLayoutEffect(() => {
    const heading = header.current?.querySelector(':scope > h1')?.textContent?.trim();
    setNamed(Boolean(heading) && titles.includes(heading!));
  }, [titles, children]);
  return (
    <header
      ref={header}
      className={cn(
        'workspace-titlebar relative flex shrink-0 items-center gap-3 border-b border-border/50 px-5',
        !isMac() && 'native-controls-right',
        named && '[&>h1]:sr-only',
      )}
    >
      {children}
      <CommandSearch className="ml-auto" />
    </header>
  );
}
