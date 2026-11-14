import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** What `POST /music/format` suggests; empty or null fields mean "no suggestion". */
export interface FormatSuggestion {
  caption: string;
  lyrics: string;
  bpm: number | null;
  key_scale: string;
  time_signature: string;
  duration: number | null;
  vocal_language: string;
}

/** The form fields Format can change, in the form's own shape. */
export interface FormatFields {
  prompt: string;
  lyrics: string;
  bpm: string;
  keyScale: string;
  timeSignature: string;
  duration: number;
  vocalLanguage: string;
}

/** The form after applying *suggestion*: only fields the model filled change. */
export function applyFormat(
  current: FormatFields,
  suggestion: FormatSuggestion,
  instrumental: boolean,
): FormatFields {
  return {
    prompt: suggestion.caption.trim() || current.prompt,
    lyrics: instrumental ? current.lyrics : suggestion.lyrics.trim() || current.lyrics,
    bpm: suggestion.bpm ? String(suggestion.bpm) : current.bpm,
    keyScale: suggestion.key_scale || current.keyScale,
    timeSignature: suggestion.time_signature || current.timeSignature,
    duration: suggestion.duration ?? current.duration,
    vocalLanguage:
      instrumental || !suggestion.vocal_language || suggestion.vocal_language === 'unknown'
        ? current.vocalLanguage
        : suggestion.vocal_language,
  };
}

interface Row {
  key: keyof FormatFields;
  label: string;
  before: string;
  after: string;
  long?: boolean;
}

export function MusicFormatDialog({
  open,
  onOpenChange,
  current,
  next,
  describe,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: FormatFields;
  next: FormatFields;
  /** How a field value reads in the UI (key names, meters, language names). */
  describe: (key: keyof FormatFields, value: string) => string;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const rows: Row[] = (
    [
      ['prompt', 'musicStudio.prompt', true],
      ['lyrics', 'musicStudio.lyrics', true],
      ['bpm', 'musicStudio.bpm', false],
      ['keyScale', 'musicStudio.key', false],
      ['timeSignature', 'musicStudio.time_signature', false],
      ['duration', 'musicStudio.duration', false],
      ['vocalLanguage', 'musicStudio.vocal_language', false],
    ] as const
  )
    .map(([key, label, long]) => ({
      key,
      label: t(label),
      before: describe(key, String(current[key] ?? '')),
      after: describe(key, String(next[key] ?? '')),
      long,
    }))
    .filter((row) => row.before !== row.after);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('musicStudio.format_title')}</DialogTitle>
          <DialogDescription>{t('musicStudio.format_help')}</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('musicStudio.format_unchanged')}
          </p>
        ) : (
          <dl className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            {rows.map((row) => (
              <div key={row.key} className="space-y-1">
                <dt className="text-label font-medium">{row.label}</dt>
                <dd className="grid gap-1">
                  <span className="text-xs text-muted-foreground line-through decoration-muted-foreground/60">
                    {row.before || t('musicStudio.auto')}
                  </span>
                  <span
                    className={
                      row.long
                        ? 'max-h-40 overflow-y-auto rounded-(--control-radius) bg-muted/40 px-2 py-1.5 whitespace-pre-wrap'
                        : ''
                    }
                  >
                    {row.after || t('musicStudio.auto')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button
            disabled={rows.length === 0}
            onClick={() => {
              onApply();
              onOpenChange(false);
            }}
          >
            {t('musicStudio.format_apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
