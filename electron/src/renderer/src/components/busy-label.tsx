import { useTranslation } from 'react-i18next';

/** A 0..1 fraction from a ratio, a fraction or nothing; null when there is no usable number. */
export function progressFraction(
  value: number | null | undefined,
  total?: number | null,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (total !== undefined && total !== null) {
    if (!Number.isFinite(total) || total <= 0) return null;
    value = value / total;
  }
  return Math.min(1, Math.max(0, value));
}

/** "42 %", "42%" or "%42", as the UI language writes a whole percent. */
export function formatPercent(fraction: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(
    // Never show 100% while the job is still running: that reads as "done".
    Math.min(fraction, 0.99),
  );
}

/**
 * The label of a Generate/Create button while its job runs: the busy text plus how far along it
 * is ("Generating… 42%"). Without a progress number it is just the busy text.
 */
export function BusyLabel({ label, progress }: { label: string; progress?: number | null }) {
  const { i18n } = useTranslation();
  const fraction = progressFraction(progress);
  return (
    <>
      {/* buttons never wrap: a long label gives way, the percent stays readable */}
      <span className="min-w-0 truncate">{label}</span>
      {/* the space keeps the accessible name "Stop 42%"; flex gap does the visual spacing */}
      {fraction !== null && ' '}
      {fraction !== null && (
        <span data-slot="busy-percent" className="tabular-nums">
          {formatPercent(fraction, i18n.language)}
        </span>
      )}
    </>
  );
}
