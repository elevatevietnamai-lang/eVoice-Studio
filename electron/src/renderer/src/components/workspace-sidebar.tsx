import { useContext, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { type LucideIcon } from 'lucide-react';
import { usePaneResize } from '@/hooks/use-pane-resize';
import { registerPanel } from '@/lib/store/workspace';
import { cn } from '@/lib/utils';
import { PanelSlotContext } from '@/components/panel-slot-context';

const WIDTHS = {
  default: { minimum: 248, initial: 280, maximum: 515, reserve: 480 },
  wide: { minimum: 296, initial: 344, maximum: 616, reserve: 520 },
  spacious: { minimum: 352, initial: 416, maximum: 750, reserve: 560 },
} as const;

const VARIANT_STYLES = {
  controls:
    '[&_summary]:min-h-8 [&_summary]:select-none [&_summary]:items-center [&_summary]:px-0.5 [&_summary]:font-medium [&_summary]:text-foreground/90 [&_summary:hover]:bg-background/35 [&_h2]:text-foreground/90 [&_h3]:text-foreground/90',
  navigation:
    '[&>button]:h-9 [&>button]:w-full [&>button]:justify-start [&>button]:gap-2.5 [&>button]:rounded-lg [&>button]:px-2.5 [&>button]:font-normal [&>button]:transition-[color,background-color,box-shadow] [&>button:hover]:bg-accent [&>button[aria-pressed=true]]:bg-accent [&>button[aria-pressed=true]]:font-medium [&>button>svg]:text-muted-foreground [&>button[aria-pressed=true]>svg]:text-primary',
  // Inputs, filters and buttons keep their own primitive styles; the library adds only focus rings.
  library:
    '[&_button]:outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring/40',
} as const;

/** Local workspace controls; the global library and navigation remain in the app shell. */
type SecondarySidebarProps = Parameters<typeof PanelBody>[0];

// A new column element (Settings to a page) remounts the panel so its effects measure the new host.
const columnKeys = new WeakMap<HTMLElement, string>();
let nextColumnKey = 0;

/**
 * Waits for the shell's panel column and renders the panel there, full height beside the rail.
 * The panel mounts only once its column exists, so its resize and registration effects see it.
 */
export function SecondarySidebar(props: SecondarySidebarProps) {
  const slot = useContext(PanelSlotContext);
  if (slot === null) return null;
  if (!slot) return <PanelBody {...props} />;
  if (!columnKeys.has(slot)) columnKeys.set(slot, String(nextColumnKey++));
  return createPortal(<PanelBody {...props} />, slot, columnKeys.get(slot));
}

function PanelBody({
  title,
  icon: Icon,
  children,
  className,
  size = 'default',
  variant = 'controls',
  meta,
  footer,
  library,
  libraryLabel,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
  size?: 'default' | 'wide' | 'spacious';
  variant?: 'controls' | 'navigation' | 'library';
  meta?: ReactNode;
  /** Pinned below the scrolling content — never scrolls out of view. */
  footer?: ReactNode;
  /** Saved items beside the controls. A render callback receives visibility so retained panes can cancel hidden work. */
  library?: ReactNode | ((active: boolean) => ReactNode);
  libraryLabel?: string;
}) {
  // One panel per page, always open beside the rail (DESIGN.md).
  useEffect(() => registerPanel(title), [title]);
  const [view, setView] = useState<'controls' | 'library'>('controls');
  const [libraryVisited, setLibraryVisited] = useState(false);
  const tabsId = useId();
  const chooseView = (next: 'controls' | 'library') => {
    if (next === 'library') setLibraryVisited(true);
    setView(next);
  };
  const showLibrary = library != null && view === 'library';
  const dimensions = WIDTHS[size];
  const resize = usePaneResize({
    storageKey: `voicestudio.secondary-sidebar.${size}`,
    side: 'left',
    ...dimensions,
    enabled: true,
  });
  return (
    <aside
      ref={resize.host}
      aria-label={title}
      data-slot="secondary-sidebar"
      data-size={size}
      data-variant={variant}
      data-resizing={resize.resizing || undefined}
      style={
        {
          '--secondary-sidebar-width': `${resize.width}px`,
        } as CSSProperties
      }
      className={cn(
        'secondary-sidebar relative [--pane-resize-display:flex] @max-[40rem]:[--pane-resize-display:none] flex min-h-0 shrink-0 flex-col border-r border-border/55 bg-[color-mix(in_oklab,var(--muted)_13%,var(--background))] shadow-[inset_-1px_0_0_color-mix(in_oklab,var(--foreground)_2%,transparent)] [container-type:inline-size]',
        'w-[var(--secondary-sidebar-width)] @max-[40rem]:max-h-[40%] @max-[40rem]:w-full @max-[40rem]:border-r-0 @max-[40rem]:border-b',
      )}
    >
      <div
        {...resize.separatorProps}
        aria-label={title}
        className="group/resize absolute inset-y-0 -right-1 z-20 [display:var(--pane-resize-display)] w-2 cursor-col-resize touch-none items-center justify-center outline-none"
      >
        <span className="h-10 w-px rounded-full bg-border/0 transition-[height,background-color] duration-150 group-hover/resize:h-16 group-hover/resize:bg-primary/45 group-focus-visible/resize:h-16 group-focus-visible/resize:bg-primary" />
      </div>
      <div
        data-slot="secondary-sidebar-header"
        className={cn(
          'workspace-titlebar flex h-12 shrink-0 items-center gap-2.5 border-b border-border/45 bg-background',
          'px-3',
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/45 bg-background/50 text-primary">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        {/* With a library, the tabs are the title: the page name is shown once (DESIGN.md). */}
        {library != null ? (
          <div
            role="tablist"
            aria-label={title}
            data-slot="secondary-sidebar-tabs"
            className="flex min-w-0 flex-1 gap-[3px] rounded-lg bg-muted p-[3px]"
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const tabs = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              ];
              const current = tabs.findIndex((tab) => tab === event.target);
              if (current < 0) return;
              const forward =
                getComputedStyle(event.currentTarget).direction === 'rtl'
                  ? 'ArrowLeft'
                  : 'ArrowRight';
              const backward = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : event.key === forward || event.key === backward
                      ? 1 - current
                      : null;
              if (next === null) return;
              event.preventDefault();
              chooseView(next === 0 ? 'controls' : 'library');
              tabs[next]?.focus();
            }}
          >
            {(
              [
                ['controls', title],
                ['library', libraryLabel ?? title],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`${tabsId}-${value}`}
                aria-controls={`${tabsId}-panel-${value}`}
                aria-selected={view === value}
                tabIndex={view === value ? 0 : -1}
                onClick={() => chooseView(value)}
                className={cn(
                  // The segmented grammar of Tabs and ToggleGroup: 4 px tabs in an 8 px frame.
                  'h-[26px] min-w-0 flex-1 truncate rounded-sm px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  view === value
                    ? 'bg-background text-foreground dark:bg-control-fill'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.014em] text-foreground/95"
            title={title}
          >
            {title}
          </span>
        )}
        {meta !== undefined && meta !== null && (
          <span className="shrink-0 rounded-sm border border-border/40 bg-muted/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {meta}
          </span>
        )}
      </div>
      {library != null && (
        <div
          role="tabpanel"
          id={`${tabsId}-panel-library`}
          aria-labelledby={`${tabsId}-library`}
          hidden={!showLibrary}
          className={cn('flex min-h-0 flex-1 flex-col', !showLibrary && 'hidden')}
        >
          {libraryVisited ? (typeof library === 'function' ? library(showLibrary) : library) : null}
        </div>
      )}
      <div
        hidden={showLibrary}
        role={library != null ? 'tabpanel' : undefined}
        id={library != null ? `${tabsId}-panel-controls` : undefined}
        aria-labelledby={library != null ? `${tabsId}-controls` : undefined}
        data-slot="secondary-sidebar-content"
        className={cn(
          'studio-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3.5 text-[13px] [scroll-padding-block:0.875rem] [scrollbar-gutter:stable] [&>*]:min-w-0 [&>section]:w-full [&>section]:shrink-0 [&_button]:max-w-full [&_h2]:tracking-[-0.012em] [&_h3]:tracking-[-0.01em] [&_input]:max-w-full [&_label]:leading-5 [&_p]:leading-[1.55] [&_summary]:rounded-lg [&_summary]:outline-none [&_summary]:transition-[color,background-color] [&_summary]:duration-150 [&_summary:hover]:text-foreground [&_summary:focus-visible]:ring-2 [&_summary:focus-visible]:ring-ring/35 [&_textarea]:max-w-full',
          VARIANT_STYLES[variant],
          showLibrary && 'hidden',
          className,
        )}
      >
        {children}
      </div>
      {footer !== undefined && footer !== null && !showLibrary && (
        <div
          data-slot="secondary-sidebar-footer"
          className="flex min-h-0 max-h-[70%] flex-col space-y-3 border-t border-border/55 bg-background p-3.5 text-[13px]"
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
