import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, LoaderCircleIcon, VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBridge } from '@/components/bridge';
import { PipelineFailure } from '@/components/pipeline-failure';
import { apiJson, apiPath, describeError } from '@/lib/api/client';
import { saveExport } from '@/lib/export-history';

export type AudiogramShape = 'square' | 'landscape' | 'vertical';
const SHAPES: readonly AudiogramShape[] = ['square', 'landscape', 'vertical'];
/** Mirrors services/audiogram.py MAX_CLIP_SECONDS. */
export const MAX_CLIP_SECONDS = 300;

/** `m:ss`, `h:mm:ss` or plain seconds → seconds; null when unreadable. */
export function parseClock(value: string): number | null {
  const parts = value.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part)))
    return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function AudiogramPanel({
  output,
  title,
  coverPath,
}: {
  output: string;
  title: string;
  coverPath?: string | null;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState('0:00');
  const [length, setLength] = useState('30');
  const [shape, setShape] = useState<AudiogramShape>('square');
  const [caption, setCaption] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startSeconds = parseClock(start);
  const lengthSeconds = Number(length);
  const valid =
    startSeconds !== null &&
    Number.isFinite(lengthSeconds) &&
    lengthSeconds >= 1 &&
    lengthSeconds <= MAX_CLIP_SECONDS;

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const clip = await apiJson<{ output: string }>('/longform/audiogram', {
        method: 'POST',
        body: JSON.stringify({
          output,
          start: startSeconds,
          duration: lengthSeconds,
          shape,
          title: caption,
          cover_path: coverPath ?? null,
        }),
      });
      const url = apiPath('/audio/' + encodeURIComponent(clip.output));
      if (getBridge()) await saveExport(url, clip.output);
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = clip.output;
        link.click();
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group rounded-(--card-radius) border border-border/60 bg-muted/20 p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <VideoIcon className="size-4 text-muted-foreground" />
        {t('audiobook.audiogram')}
        <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <fieldset disabled={busy} className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          {t('audiobook.audiogram_hint', { max: MAX_CLIP_SECONDS })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('audiobook.audiogram_start')}</span>
            <Input
              value={start}
              inputMode="numeric"
              aria-invalid={startSeconds === null}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('audiobook.audiogram_length')}</span>
            <Input
              type="number"
              min={1}
              max={MAX_CLIP_SECONDS}
              value={length}
              onChange={(event) => setLength(event.target.value)}
            />
          </label>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('audiobook.audiogram_shape')}</p>
          <div className="flex flex-wrap gap-1">
            {SHAPES.map((value) => (
              <Button
                key={value}
                size="xs"
                aria-pressed={shape === value}
                variant={shape === value ? 'secondary' : 'ghost'}
                onClick={() => setShape(value)}
              >
                {t(`audiobook.audiogram_shape_${value}`)}
              </Button>
            ))}
          </div>
        </div>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">{t('audiobook.audiogram_title')}</span>
          <Input
            value={caption}
            maxLength={120}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <Button className="w-full" disabled={!valid || busy} onClick={() => void create()}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <VideoIcon />}
          {t(busy ? 'audiobook.audiogram_rendering' : 'audiobook.audiogram_create')}
        </Button>
      </fieldset>
      {error && (
        <PipelineFailure fallback={error} onDismiss={() => setError(null)} className="text-xs" />
      )}
    </details>
  );
}
