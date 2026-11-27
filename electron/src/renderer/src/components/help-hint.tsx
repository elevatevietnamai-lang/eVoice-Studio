import { CircleHelpIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/popover';
import { cn } from '@/lib/utils';

/**
 * A "?" beside a control's title that holds its explanation (DESIGN.md: explanations sit
 * behind a "?" beside their title). Hover, a click, a tap or Enter opens it; Escape closes it.
 * It is a popover, not a tooltip: tooltips only name icon-only controls.
 *
 * Never place it inside a `<label>` or another button: a button inside a label becomes the
 * label's control, so clicking the label text would open the help instead of toggling.
 */
export function HelpHint({
  label,
  children,
  className,
  style,
}: {
  /** What it explains, for the button's accessible name ("About: Thinking"). */
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        render={
          <button
            type="button"
            data-slot="help-hint"
            style={style}
            aria-label={t('common.help_for', { name: label })}
            className={cn(
              'inline-grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:text-foreground',
              className,
            )}
          />
        }
      >
        <CircleHelpIcon className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        data-slot="help-hint-content"
        className="max-w-xs p-3 text-xs leading-5 text-popover-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The "?" button's size (`size-5`), which `DisclosureHelp` centres on the summary row. */
const HINT_SIZE = 20;

/**
 * A `<details>` panel (its only child) with its "?" at the end of the summary row. A summary
 * cannot hold a button, and a closed panel hides everything but its summary, so the "?" sits
 * over the summary's end from outside the panel. It measures the summary, since panels differ in
 * padding and row height, and reserves room at the summary's end so nothing runs under it.
 */
export function DisclosureHelp({
  label,
  help,
  children,
}: {
  label: string;
  help: ReactNode;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const summary = outer?.querySelector(':scope > details > summary');
    if (!outer || !(summary instanceof HTMLElement)) return;
    summary.style.paddingInlineEnd = `${HINT_SIZE + 8}px`;
    const measure = () => {
      const frame = outer.getBoundingClientRect();
      const row = summary.getBoundingClientRect();
      const rtl = getComputedStyle(outer).direction === 'rtl';
      setPlace({
        top: row.top - frame.top + (row.height - HINT_SIZE) / 2,
        end: (rtl ? row.left - frame.left : frame.right - row.right) + 2,
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(summary);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="relative">
      {children}
      <HelpHint
        label={label}
        className={cn('absolute', !place && 'invisible')}
        style={place ? { top: place.top, insetInlineEnd: place.end } : undefined}
      >
        {help}
      </HelpHint>
    </div>
  );
}

/** A control's title with its "?" right beside it. */
export function TitleWithHelp({
  id,
  title,
  help,
  className,
}: {
  id?: string;
  title: string;
  help: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      <span id={id} className="min-w-0 truncate font-medium">
        {title}
      </span>
      <HelpHint label={title}>{help}</HelpHint>
    </span>
  );
}
