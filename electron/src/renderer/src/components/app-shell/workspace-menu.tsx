import { useEffect } from 'react';
import { setMenuGroup, useMenuGroup } from '@/lib/store/workspace';
import { Link, useRouterState } from '@tanstack/react-router';
import { AudioLinesIcon, FilmIcon, FingerprintIcon, WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MenuReveal, MenuRevealItem } from '@/components/motion';
import { inGroup, type DestinationGroup, type WorkspaceDestination } from './destinations';
import './workspace-menu.css';

type Destination = WorkspaceDestination;

const itemClass =
  'workspace-nav-item group relative flex min-w-0 items-center overflow-hidden rounded-lg text-sm text-(--sidebar-muted-foreground) outline-none transition-colors duration-160 hover:bg-(--sidebar-row-hover) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring';
const iconClass =
  'workspace-nav-icon size-5 shrink-0 text-(--sidebar-muted-foreground) transition-colors duration-160';

function NavigationLink({
  destination: { to, label, description, icon: Icon, activate },
  compact = false,
  flyout = false,
  onNavigate,
}: {
  destination: Destination;
  compact?: boolean;
  flyout?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const link = (
    <Link
      to={to}
      aria-label={compact ? t(label) : undefined}
      onClick={() => {
        activate?.();
        // Choosing a page, even the one already open, turns the menu column back into its panel.
        setMenuGroup(null);
        onNavigate?.();
      }}
      className={cn(
        itemClass,
        compact
          ? 'size-10 justify-center'
          : flyout
            ? 'min-h-12 gap-3 px-2.5 py-2'
            : 'min-h-11 gap-3 px-2.5 py-1.5',
      )}
      activeProps={{
        className: 'bg-(--sidebar-row-selected) font-medium text-sidebar-foreground',
        'aria-current': 'page',
      }}
    >
      <Icon className={iconClass} aria-hidden="true" />
      {!compact && (
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
  group,
  label,
  icon: Icon,
  children,
  pathname,
}: {
  group: DestinationGroup;
  label: string;
  icon: typeof AudioLinesIcon;
  children: Destination[];
  pathname: string;
}) {
  const { t } = useTranslation();
  const active = children.some(({ to }) => pathname === to || pathname.startsWith(to + '/'));
  const open = useMenuGroup() === group;
  const triggerClass = cn(
    itemClass,
    'size-10 w-full justify-center',
    (active || open) && 'bg-(--sidebar-row-selected) text-sidebar-foreground',
  );
  return (
    // Hover names the group; a click fills the panel column with its menu, a second click
    // gives the column back to the page's panel.
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={t(label)}
            aria-expanded={open}
            aria-controls={open ? GROUP_MENU_ID : undefined}
            data-active={active}
            data-menu-group={group}
            className={triggerClass}
            onClick={() => setMenuGroup(open ? null : group)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              setMenuGroup(group);
              requestAnimationFrame(() =>
                document.getElementById(GROUP_MENU_ID)?.querySelector('a')?.focus(),
              );
            }}
          />
        }
      >
        <Icon className={iconClass} aria-hidden="true" />
      </TooltipTrigger>
      {!open && <TooltipContent side="right">{t(label)}</TooltipContent>}
    </Tooltip>
  );
}

export function WorkspaceNavigation() {
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
        'space-y-0.5 px-1.5',
      )}
    >
      <NavigationGroup
        group="voice"
        label="nav.voice"
        icon={FingerprintIcon}
        children={inGroup('voice')}
        pathname={pathname}
      />
      <NavigationGroup
        group="stories"
        label="nav.stories"
        icon={AudioLinesIcon}
        children={inGroup('stories')}
        pathname={pathname}
      />
      <NavigationGroup
        group="dub"
        label="nav.dub"
        icon={FilmIcon}
        children={inGroup('dub')}
        pathname={pathname}
      />
      <NavigationGroup
        group="more"
        label="nav.more"
        icon={WrenchIcon}
        children={inGroup('more')}
        pathname={pathname}
      />
      {inGroup('library').map((destination) => (
        <NavigationLink key={destination.to} destination={destination} compact />
      ))}
    </nav>
  );
}

const GROUP_MENU_ID = 'workspace-group-menu';

const GROUPS: Record<Exclude<DestinationGroup, 'library'>, string> = {
  voice: 'nav.voice',
  stories: 'nav.stories',
  dub: 'nav.dub',
  more: 'nav.more',
};

/**
 * The menu of the rail group the user opened, in the panel column: section name, then each page
 * with its one-line description. Choosing a page closes it, and the column shows that page's panel.
 */
export function GroupMenuPanel() {
  const { t } = useTranslation();
  const group = useMenuGroup() as keyof typeof GROUPS | null;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => setMenuGroup(null), [pathname]);
  if (!group || !(group in GROUPS)) return null;
  const close = () => {
    setMenuGroup(null);
    document.querySelector<HTMLElement>(`[data-menu-group="${group}"]`)?.focus();
  };
  return (
    <aside
      id={GROUP_MENU_ID}
      aria-label={t(GROUPS[group])}
      data-slot="group-menu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        close();
      }}
      className="absolute inset-y-0 left-0 z-30 flex w-[max(100%,18rem)] flex-col border-r border-border/55 bg-sidebar"
    >
      <div className="workspace-titlebar flex h-12 shrink-0 items-center border-b border-border/45 px-4">
        <span className="truncate text-xs font-medium tracking-[0.12em] text-(--sidebar-muted-foreground) uppercase">
          {t(GROUPS[group])}
        </span>
      </div>
      {/* Keyed on the group, so a switch replays the reveal. */}
      <MenuReveal
        key={group}
        aria-label={t(GROUPS[group])}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2"
      >
        {inGroup(group).map((destination) => (
          <MenuRevealItem key={destination.to}>
            <NavigationLink destination={destination} flyout />
          </MenuRevealItem>
        ))}
      </MenuReveal>
    </aside>
  );
}
