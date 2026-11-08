import { Menu } from '@base-ui/react/menu';
import { BookOpenIcon, EllipsisIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { useLongformSession, type Mode } from '@/features/longform/longform-session';
import { menuPopupClass } from '@/components/menu-popup';
import { cn } from '@/lib/utils';
export function VoiceDestinations({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose(target: Mode): void;
}) {
  const { t } = useTranslation();
  const production = useLongformSession().active;
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled || Boolean(production)}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        aria-label={t('gallery.more_actions')}
      >
        <EllipsisIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className={cn(menuPopupClass, 'min-w-56 p-1')}>
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
              onClick={() => onChoose('stories')}
            >
              <UsersIcon className="size-4" />
              {t('gallery.use_in_stories')}
            </Menu.Item>
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
              onClick={() => onChoose('audiobook')}
            >
              <BookOpenIcon className="size-4" />
              {t('gallery.set_audiobook_default')}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
