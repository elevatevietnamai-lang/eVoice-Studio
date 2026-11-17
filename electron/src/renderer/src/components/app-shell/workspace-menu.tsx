import { useEffect } from 'react';
import { setMenuGroup, useMenuGroup } from '@/lib/store/workspace';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  AudioLinesIcon,
  FilmIcon,
  FingerprintIcon,
  LayoutDashboardIcon,
  WrenchIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_MENU_HOME, APP_MENU_HOME_ACCELERATOR, APP_MENU_PAGES } from '@shared/app-menu';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MenuReveal, MenuRevealItem, menuSurfaceMotion } from '@/components/motion';
import { inGroup, type DestinationGroup, type WorkspaceDestination } from './destinations';
import { ShellTooltip } from './shell-tooltip';
import './workspace-menu.css';

/** The keyboard shortcut the application menu gives a page, shown in its rail tooltip. */
function pageAccelerator(path: string): string | undefined {
  if (path === APP_MENU_HOME) return APP_MENU_HOME_ACCELERATOR;
  return APP_MENU_PAGES.find((page) => page.path === path)?.accelerator;
}

type Destination = WorkspaceDestination;

/** Home leads the rail; it is not a menu group, so it stays out of `destinations`. */
const HOME: Destination = {
  to: '/',
  label: 'nav.home',
  description: 'shell.home_hint',
  icon: LayoutDashboardIcon,
  group: 'library',
};

const itemClass =
  'workspace-nav-item group relative flex min-w-0 items-center overflow-hidden rounded-lg text-sm text-(--sidebar-muted-foreground) outline-none transition-colors hover:bg-(--sidebar-row-hover) hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';
const iconClass =
  'workspace-nav-icon size-5 shrink-0 text-(--sidebar-muted-foreground) transition-colors';
/** The page panel's header tile (components/workspace-sidebar.tsx): menu and panel share one grammar. */
const tileClass =
  'grid size-7 shrink-0 place-items-center rounded-lg border border-border/45 transition-colors';

function NavigationLink({
  destination: { to, label, description, icon: Icon, activate },
  compact = false,
  flyout = false,
  exact = false,
  onNavigate,
}: {
  destination: Destination;
  compact?: boolean;
  flyout?: boolean;
  /** Lit only on this exact path (Home's `/` is a prefix of every route). */
  exact?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  // The rail lights one item at a time: while a group's menu is open, that group, not the page.
  const menuOpen = useMenuGroup() !== null;
  const lit = !(compact && menuOpen);
  const link = (
    <Link
      to={to}
      aria-label={compact ? t(label) : undefined}
      activeOptions={exact ? { exact: true } : undefined}
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
            ? 'min-h-12 gap-3 px-2 py-2'
            : 'min-h-11 gap-3 px-2.5 py-1.5',
      )}
      activeProps={{
        className: lit
          ? 'bg-(--sidebar-row-selected) font-medium text-sidebar-foreground'
          : undefined,
        'aria-current': 'page',
        'data-lit': lit ? 'true' : undefined,
      }}
    >
      {compact ? (
        <Icon className={iconClass} aria-hidden="true" />
      ) : (
        <span className={tileClass} aria-hidden="true">
          <Icon className={cn(iconClass, 'size-4')} />
        </span>
      )}
      {!compact && (
        <span className="min-w-0 flex-1 leading-5">
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
    <ShellTooltip
      side="right"
      label={t(label)}
      hint={t(description)}
      accelerator={pageAccelerator(to)}
    >
      {link}
    </ShellTooltip>
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
  const menuGroup = useMenuGroup();
  const open = menuGroup === group;
  // One lit rail item: the open menu's group while a menu is open, else the current page's group.
  const lit = menuGroup ? open : active;
  const triggerClass = cn(
    itemClass,
    'size-10 justify-center',
    lit && 'bg-(--sidebar-row-selected) text-sidebar-foreground',
  );
  return (
    // Hover names the group and the pages in it; a click fills the panel column with its menu, a
    // second click gives the column back to the page's panel.
    <ShellTooltip
      side="right"
      disabled={open}
      label={t(label)}
      hint={children.map((page) => t(page.label)).join(' · ')}
    >
      <button
        type="button"
        aria-label={t(label)}
        aria-expanded={open}
        aria-controls={open ? GROUP_MENU_ID : undefined}
        data-active={active}
        data-lit={lit || undefined}
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
      >
        <Icon className={iconClass} aria-hidden="true" />
      </button>
    </ShellTooltip>
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
        // Straight under the logo, from the top: not centred in the rail's height.
        'flex flex-col items-center justify-start gap-0.5 px-1.5',
      )}
    >
      <NavigationLink destination={HOME} compact exact />
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

const GROUP_ICONS: Record<keyof typeof GROUPS, typeof AudioLinesIcon> = {
  voice: FingerprintIcon,
  stories: AudioLinesIcon,
  dub: FilmIcon,
  more: WrenchIcon,
};

/**
 * The menu of the rail group the user opened, in the panel column: section name, then each page
 * with its one-line description. Choosing a page closes it, and the column shows that page's panel.
 */
export function GroupMenuPanel() {
  const group = useMenuGroup() as keyof typeof GROUPS | null;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => setMenuGroup(null), [pathname]);
  const shown = group !== null && group in GROUPS;
  return <AnimatePresence>{shown && <GroupMenu key="group-menu" group={group} />}</AnimatePresence>;
}

function GroupMenu({ group }: { group: keyof typeof GROUPS }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion() ?? false;
  const GroupIcon = GROUP_ICONS[group];
  const close = () => {
    setMenuGroup(null);
    document.querySelector<HTMLElement>(`[data-menu-group="${group}"]`)?.focus();
  };
  return (
    <motion.aside
      {...menuSurfaceMotion(reduced)}
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
      {/* The panel header it covers, in the same grammar: tile, then the name in sentence case
          (all-caps and letter spacing break Vietnamese diacritics, DESIGN.md section 3). */}
      <div className="workspace-titlebar flex h-12 shrink-0 items-center gap-2.5 border-b border-border/45 px-3">
        <span className={cn(tileClass, 'text-sidebar-foreground')} aria-hidden="true">
          <GroupIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
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
    </motion.aside>
  );
}
