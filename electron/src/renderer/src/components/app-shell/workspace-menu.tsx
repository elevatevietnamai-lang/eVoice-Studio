import { useEffect, useId, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/popover';
import { Link, useRouterState } from '@tanstack/react-router';
import { AudioLinesIcon, ChevronRightIcon, FilmIcon, FingerprintIcon, WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { inGroup, type WorkspaceDestination } from './destinations';
import './workspace-menu.css';

type Destination = WorkspaceDestination;

const itemClass =
  'workspace-nav-item group relative flex min-w-0 items-center overflow-hidden rounded-md text-sm text-(--sidebar-muted-foreground) outline-none transition-colors duration-160 hover:bg-(--sidebar-row-hover) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring';
const iconClass =
  'workspace-nav-icon size-5 shrink-0 text-(--sidebar-muted-foreground) transition-colors duration-160';

function NavigationLink({
  destination: { to, label, description, icon: Icon, activate },
  compact = false,
  flyout = false,
  onCurrentRoute,
}: {
  destination: Destination;
  compact?: boolean;
  flyout?: boolean;
  onCurrentRoute?: () => void;
}) {
  const { t } = useTranslation();
  const link = (
    <Link
      to={to}
      aria-label={compact ? t(label) : undefined}
      onClick={() => {
        activate?.();
        onCurrentRoute?.();
      }}
      className={cn(
        itemClass,
        compact
          ? 'size-10 justify-center'
          : flyout
            ? 'h-10 gap-2.5 px-3'
            : 'min-h-11 gap-3 px-2.5 py-1.5',
      )}
      activeProps={{
        className: 'bg-(--sidebar-row-selected) font-medium text-sidebar-foreground',
        'aria-current': 'page',
      }}
    >
      <Icon className={iconClass} aria-hidden="true" />
      {!compact && !flyout && (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate">{t(label)}</span>
          <span
            aria-hidden="true"
            className="mt-0.5 block truncate text-xs font-normal text-(--sidebar-muted-foreground)"
          >
            {t(description)}
          </span>
        </span>
      )}
      {flyout && <span className="truncate">{t(label)}</span>}
    </Link>
  );
  if (!compact) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{t(label)}</TooltipContent>
    </Tooltip>
  );
}

function NavigationGroup({
  label,
  icon: Icon,
  children,
  compact,
  pathname,
}: {
  label: string;
  icon: typeof AudioLinesIcon;
  children: Destination[];
  compact: boolean;
  pathname: string;
}) {
  const { t } = useTranslation();
  const active = children.some(({ to }) => pathname === to || pathname.startsWith(to + '/'));
  const [expanded, setExpanded] = useState(active);
  const [popupOpen, setPopupOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOpen = () => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPopupOpen(false), 240);
  };
  const id = useId();
  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [],
  );
  useEffect(() => {
    cancelOpen();
    cancelClose();
    setExpanded(active);
    setPopupOpen(false);
  }, [pathname, active]);
  const triggerClass = cn(
    itemClass,
    'w-full',
    compact
      ? 'size-10 justify-center'
      : 'h-7 gap-2 px-2.5 text-xs font-medium uppercase tracking-wide',
    active && compact && 'bg-(--sidebar-row-selected) text-sidebar-foreground',
  );
  if (compact)
    return (
      <Popover
        open={popupOpen}
        onOpenChange={(open) => {
          cancelOpen();
          cancelClose();
          setPopupOpen(open);
        }}
      >
        <PopoverTrigger
          ref={triggerRef}
          aria-label={t(label)}
          data-active={active}
          className={triggerClass}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            cancelOpen();
            setPopupOpen(true);
            requestAnimationFrame(() => popupRef.current?.querySelector('a')?.focus());
          }}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            cancelClose();
            if (!popupOpen) {
              cancelOpen();
              openTimer.current = setTimeout(() => setPopupOpen(true), 90);
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') {
              cancelOpen();
              if (popupOpen) scheduleClose();
            }
          }}
          onClickCapture={(event) => {
            // A press on an already hover-open trigger should keep the flyout
            // available. Keyboard and touch presses retain Base UI's toggle.
            if (popupOpen && event.detail > 0) event.stopPropagation();
          }}
        >
          <Icon
            className={iconClass}
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent
          ref={popupRef}
          side="right"
          sideOffset={0}
          className="w-52 p-1.5 data-open:zoom-in-100 data-closed:zoom-out-100"
          onPointerEnter={cancelClose}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') scheduleClose();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft') return;
            event.preventDefault();
            setPopupOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <div className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
            {t(label)}
          </div>
          <div>
            {children.map((destination) => (
              <NavigationLink
                key={destination.to}
                destination={destination}
                flyout
                onCurrentRoute={pathname === destination.to ? () => setPopupOpen(false) : undefined}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  return (
    <div className="py-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        data-active={active}
        onClick={() => setExpanded((value) => !value)}
        className={triggerClass}
      >
        <span className="truncate">{t(label)}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            'ml-auto size-3.5 shrink-0 transition-transform duration-160 motion-reduce:transition-none',
            expanded && 'rotate-90',
          )}
        />
      </button>
      <div
        id={id}
        aria-hidden={!expanded}
        inert={!expanded}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-240 motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 space-y-0.5">
            {children.map((destination) => (
              <NavigationLink key={destination.to} destination={destination} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceNavigation({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <nav
      data-slot="workspace-navigation"
      aria-label={t('nav.workspaces')}
      className={cn(
        'min-h-0 overflow-y-auto overscroll-contain py-2 [scrollbar-width:none]',
        compact ? 'space-y-0.5 px-1.5' : 'shrink-0 space-y-0.5 px-3',
      )}
    >
      <NavigationGroup
        label="nav.voice"
        icon={FingerprintIcon}
        children={inGroup('voice')}
        compact={compact}
        pathname={pathname}
      />
      <NavigationGroup
        label="nav.stories"
        icon={AudioLinesIcon}
        children={inGroup('stories')}
        compact={compact}
        pathname={pathname}
      />
      <NavigationGroup
        label="nav.dub"
        icon={FilmIcon}
        children={inGroup('dub')}
        compact={compact}
        pathname={pathname}
      />
      <NavigationGroup
        label="nav.more"
        icon={WrenchIcon}
        children={inGroup('more')}
        compact={compact}
        pathname={pathname}
      />
      {inGroup('library').map((destination) => (
        <NavigationLink key={destination.to} destination={destination} compact={compact} />
      ))}
    </nav>
  );
}
