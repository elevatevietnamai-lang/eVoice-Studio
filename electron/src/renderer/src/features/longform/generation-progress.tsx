import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CircleIcon, LoaderCircleIcon, XIcon, ZapIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '@/components/busy-label';
import type { AudiobookRenderChapter } from './longform-session';

function ChapterStatusIcon({ status }: { status: string }) {
  if (status === 'rendering')
    return <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />;
  if (status === 'done') return <CheckIcon className="size-3.5" />;
  if (status === 'cached') return <ZapIcon className="size-3.5" />;
  if (status === 'failed') return <XIcon className="size-3.5" />;
  return <CircleIcon className="size-3.5" />;
}

export function GenerationProgress({
  chapters,
  assembling,
}: {
  chapters: AudiobookRenderChapter[];
  assembling: boolean;
}) {
  const { t } = useTranslation();
  const start = useRef(performance.now());
  const [now, setNow] = useState(start.current);
  const completed = useMemo(
    () =>
      chapters.filter((chapter) => ['done', 'cached', 'failed'].includes(chapter.status)).length,
    [chapters],
  );
  const total = chapters.length;
  const elapsed = (now - start.current) / 1000;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-(--card-radius) border border-border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">
          {assembling
            ? t('audiobook.assembling')
            : t('audiobook.progress_summary', { current: completed, total })}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {/* Elapsed only: the percent and time left live on the Stop button. */}
          {formatClock(elapsed)}
        </span>
      </div>
      {total > 0 && (
        <ol className="mt-2 max-h-36 space-y-0.5 overflow-y-auto">
          {chapters.map((chapter, index) => (
            <li
              key={index}
              title={chapter.status === 'failed' ? chapter.error : undefined}
              className="flex min-w-0 items-center gap-2 py-0.5 text-xs"
            >
              <span
                className={
                  chapter.status === 'failed'
                    ? 'text-destructive'
                    : chapter.status === 'rendering'
                      ? 'text-primary'
                      : 'text-muted-foreground'
                }
              >
                <ChapterStatusIcon status={chapter.status} />
              </span>
              <span
                className={`truncate ${
                  chapter.status === 'pending'
                    ? 'text-muted-foreground'
                    : chapter.status === 'rendering'
                      ? 'font-medium'
                      : 'text-foreground/90'
                }`}
              >
                {chapter.title || t('audiobook.chapter_n', { n: index + 1 })}
              </span>
              {chapter.status === 'cached' && (
                <span className="shrink-0 text-muted-foreground">
                  · {t('audiobook.cached_tag')}
                </span>
              )}
              {chapter.status === 'failed' && (
                <span className="min-w-0 truncate text-destructive/80">
                  · {t('audiobook.failed_tag')}
                  {chapter.error ? `: ${chapter.error}` : ''}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
