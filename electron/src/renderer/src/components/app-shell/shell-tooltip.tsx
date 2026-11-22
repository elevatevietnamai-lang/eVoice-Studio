import type { ReactElement } from 'react';
import { formatAccelerator } from '@shared/app-menu';
import { isMac } from '@/components/bridge';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The one hover label for every control in the app's frame (the icon rail, the title bar corner
 * and the window buttons): the control's name, an optional one-line hint of what it holds, and its
 * keyboard shortcut. Rail items open it to the right, title bar items below. It replaces native
 * `title` attributes there, so a control never shows two labels.
 */
export function ShellTooltip({
  label,
  hint,
  accelerator,
  side,
  disabled = false,
  children,
}: {
  label: string;
  hint?: string;
  /** Electron accelerator (`CmdOrCtrl+9`), shown as the platform reads it. */
  accelerator?: string;
  side: 'right' | 'bottom';
  /** While the control's own menu or popover is open, its tooltip stays away. */
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        sideOffset={side === 'right' ? 8 : 6}
        data-shell-tooltip=""
        className="max-w-80 items-start gap-3 py-2"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="font-medium whitespace-nowrap">{label}</span>
          {hint && <span className="leading-4 text-muted-foreground">{hint}</span>}
        </span>
        {accelerator && (
          <Kbd className="mt-px shrink-0">{formatAccelerator(accelerator, isMac())}</Kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
