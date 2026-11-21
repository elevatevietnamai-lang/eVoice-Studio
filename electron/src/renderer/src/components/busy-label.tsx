import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

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

/** "0:42", "12:05" or "1:02:05": a duration in whole seconds, as a clock reads it. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Progress has to move this much, over at least this long, before a remaining time is shown. */
export const ETA_MIN_PROGRESS = 0.05;
export const ETA_MIN_SECONDS = 5;

/**
 * Seconds left in a running job, from how fast its progress (0..1) has moved, or null.
 *
 * The rate is measured from the moment progress first moves, not from the job's start or its first
 * sample: a long engine start (music sits at 0 % for a minute, then jumps to 10 % when the
 * server is up) is a stage marker, not a rate, and would make the estimate several times too
 * long. Nothing is shown until progress has moved `ETA_MIN_PROGRESS` over `ETA_MIN_SECONDS`
 * after that; the estimate is smoothed, counts down between updates, and starts over when
 * `resetKey` changes (a new stage or language) or progress goes backwards.
 */
export function useEta(
  progress: number | null | undefined,
  { running = true, resetKey }: { running?: boolean; resetKey?: unknown } = {},
): number | null {
  const anchor = useRef<{ p: number; t: number } | null>(null);
  const first = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const smooth = useRef<{ seconds: number; at: number } | null>(null);
  const [estimate, setEstimate] = useState<{ seconds: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    anchor.current = null;
    first.current = null;
    last.current = null;
    smooth.current = null;
    setEstimate(null);
  }, [resetKey, running]);

  useEffect(() => {
    if (!running || typeof progress !== 'number' || !Number.isFinite(progress)) return;
    const t = Date.now();
    if (last.current !== null && progress < last.current - 1e-6) {
      anchor.current = null;
      first.current = null;
      smooth.current = null;
      setEstimate(null);
    }
    last.current = progress;
    if (first.current === null) {
      first.current = progress;
      return;
    }
    if (!anchor.current) {
      // The first move itself is not a rate (it may be the end of a startup stage): start
      // timing from where it landed.
      if (progress > first.current + 1e-6) anchor.current = { p: progress, t };
      return;
    }
    const moved = progress - anchor.current.p;
    const seconds = (t - anchor.current.t) / 1000;
    if (moved < ETA_MIN_PROGRESS || seconds < ETA_MIN_SECONDS) return;
    const raw = (seconds * (1 - progress)) / moved;
    // Blend with the previous estimate as it stands now (counted down), so a steady job's
    // estimate does not lag behind it.
    const previous =
      smooth.current === null ? null : smooth.current.seconds - (t - smooth.current.at) / 1000;
    const blended = previous === null || previous <= 0 ? raw : previous * 0.7 + raw * 0.3;
    smooth.current = { seconds: blended, at: t };
    setEstimate({ seconds: blended, at: t });
    setNow(t);
  }, [progress, running, resetKey]);

  useEffect(() => {
    if (!estimate || !running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [estimate, running]);

  if (!estimate || !running) return null;
  const left = estimate.seconds - (now - estimate.at) / 1000;
  // Past the estimate with no new progress: say nothing rather than a wrong "0:00".
  return left >= 1 ? Math.round(left) : null;
}

/**
 * The label of a Generate/Create button while its job runs: the busy text, how far along it is
 * and, once it can be estimated, the time left ("Generating… 42% · ~1:20 left"). Without a
 * progress number it is just the busy text.
 */
export function BusyLabel({
  label,
  progress,
  eta,
}: {
  label: string;
  progress?: number | null;
  /** Seconds left, from `useEta`. */
  eta?: number | null;
}) {
  const { t, i18n } = useTranslation();
  const fraction = progressFraction(progress);
  const left =
    typeof eta === 'number' && eta >= 1 ? t('common.time_left', { time: formatClock(eta) }) : null;
  return (
    <>
      {/* buttons never wrap: a long label gives way, the percent stays readable */}
      <span className="min-w-0 truncate">{label}</span>
      {/* the space keeps the accessible name "Stop 42%"; flex gap does the visual spacing */}
      {fraction !== null && ' '}
      {fraction !== null && (
        <span data-slot="busy-percent" className="shrink-0 tabular-nums">
          {formatPercent(fraction, i18n?.language ?? 'en')}
        </span>
      )}
      {left !== null && ' '}
      {left !== null && (
        <span data-slot="busy-eta" className="shrink-0 tabular-nums opacity-80">
          {fraction !== null ? `· ${left}` : left}
        </span>
      )}
    </>
  );
}

/**
 * The job's progress for assistive technology only. The visible percent lives in the button
 * (DESIGN.md: progress lives in the button that started the job), but a disabled button's label
 * is not announced, so this keeps a `progressbar` with its value. `value` is 0..100; null is an
 * indeterminate bar.
 */
export function JobProgress({ value, label }: { value: number | null | undefined; label: string }) {
  return (
    <ProgressPrimitive.Root
      value={typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null}
      aria-label={label}
      className="sr-only"
      data-slot="job-progress"
    />
  );
}
