import { Menu } from '@base-ui/react/menu';
import { useNavigate } from '@tanstack/react-router';
import { LogOutIcon, UserRoundCogIcon, UserRoundIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/features/account/use-account';
import { runRendererTask } from '@/lib/global-error-recovery';
import { cn } from '@/lib/utils';
import { menuItemClass, menuPopupClass } from '@/components/menu-popup';

function initials(name: string): string {
  const words = name.includes('@') ? [name] : name.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (!url && !name)
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground">
        <UserRoundIcon className="size-4" aria-hidden="true" />
      </span>
    );
  return url ? (
    <img src={url} alt="" className="size-7 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-primary"
    >
      {initials(name)}
    </span>
  );
}

/**
 * The account control in the window's top-right corner: the profile photo (or
 * initials) and name, with a menu for Account settings and Sign out; signed out,
 * a Sign in button. Nothing shows unless the user turned account features on.
 */
export function AccountMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { state, signIn, signOut } = useAccount();
  if (!state?.available || !state.accountEnabled) return null;

  if (!state.signedIn) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={state.signingIn}
        onClick={() => void signIn()}
        className={cn('h-8', className)}
      >
        {t(state.signingIn ? 'account.continue_in_browser' : 'account.sign_in')}
      </Button>
    );
  }

  const name = state.profile?.displayName || state.profile?.email || '';
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={name || t('account.menu_settings')}
        data-slot="account-menu"
        className={cn(
          'flex h-8 max-w-56 min-w-0 items-center gap-2 rounded-full border border-border bg-card py-0.5 pr-3 pl-0.5 outline-none transition-colors duration-160 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
      >
        <Avatar name={name} url={state.profile?.avatarUrl ?? null} />
        {name && <span className="min-w-0 truncate text-sm font-medium">{name}</span>}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className={cn(menuPopupClass, 'min-w-52 p-1')}>
            <Menu.Item
              className={menuItemClass}
              onClick={() =>
                runRendererTask('Open account settings', () =>
                  navigate({ to: '/settings/account' }),
                )
              }
            >
              <UserRoundCogIcon className="size-4" aria-hidden="true" />
              {t('account.menu_settings')}
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => void signOut()}>
              <LogOutIcon className="size-4" aria-hidden="true" />
              {t('account.sign_out')}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
