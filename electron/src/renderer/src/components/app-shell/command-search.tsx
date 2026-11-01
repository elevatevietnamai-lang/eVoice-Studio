import { SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMac } from '@/components/bridge';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/**
 * The header's search field: opens the command palette. Wide headers centre it on the window
 * (absolute, so the account corner's width cannot push it off-centre); narrow ones keep a 32px icon
 * button on the right. It sits inside a container-query context, so it follows the pane, not the window.
 */
export function CommandSearch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t('preferences.search');
  return (
    <button
      type="button"
      aria-label={label}
      title={isMac() ? 'Command + K' : 'Ctrl + K'}
      onClick={() => window.dispatchEvent(new Event('voicestudio:commands'))}
      className={cn(
        'app-no-drag group flex size-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent text-muted-foreground outline-none transition-colors duration-160 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        '@3xl:absolute @3xl:top-1/2 @3xl:left-1/2 @3xl:w-[min(26rem,38%)] @3xl:-translate-x-1/2 @3xl:-translate-y-1/2 @3xl:justify-start @3xl:border-input @3xl:bg-control-fill @3xl:px-3',
        className,
      )}
    >
      <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden min-w-0 flex-1 truncate text-left text-sm @3xl:block">{label}</span>
      <Kbd className="hidden @3xl:inline-flex">{isMac() ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  );
}
