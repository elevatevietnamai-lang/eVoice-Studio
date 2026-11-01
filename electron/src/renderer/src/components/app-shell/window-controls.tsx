import { useEffect, useState } from 'react';
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getBridge, isMac } from '@/components/bridge';
import { cn } from '@/lib/utils';

const buttonClass =
  'app-no-drag flex h-10 w-[46px] items-center justify-center text-muted-foreground outline-none transition-colors duration-160 hover:bg-accent hover:text-foreground active:bg-(--sidebar-row-selected) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/**
 * Minimize, maximize and close for the frameless window on Windows and Linux (macOS keeps its traffic
 * lights). Drawn here instead of by the OS overlay so they share the app's hover, cursor and theme.
 * Mounted once at the app root so first-run setup and the backend gate have them too. The group takes
 * the 138px that `.native-controls-right` and the account corner already keep free on the right.
 */
export function WindowControls() {
  const { t } = useTranslation();
  const windowApi = getBridge()?.window;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!windowApi) return;
    let live = true;
    void windowApi.isMaximized().then((value) => live && setMaximized(value));
    const stop = windowApi.onMaximizedChange(setMaximized);
    return () => {
      live = false;
      stop();
    };
  }, [windowApi]);
  if (!windowApi || isMac()) return null;
  return (
    <div
      data-slot="window-controls"
      className="app-no-drag fixed top-0 right-0 z-[60] flex h-10 items-stretch"
    >
      <button
        type="button"
        aria-label={t('windowControls.minimize')}
        className={buttonClass}
        onClick={() => windowApi.minimize()}
      >
        <MinusIcon className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t(maximized ? 'windowControls.restore' : 'windowControls.maximize')}
        className={buttonClass}
        onClick={() => windowApi.toggleMaximize()}
      >
        {maximized ? (
          <CopyIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <SquareIcon className="size-3.5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        className={cn(
          buttonClass,
          'hover:bg-destructive hover:text-white active:bg-destructive/85 focus-visible:ring-white',
        )}
        onClick={() => windowApi.close()}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
