import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircleIcon, UploadIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { TitleWithHelp } from '@/components/help-hint';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiJson, describeError } from '@/lib/api/client';

/** Audio the backend resolves itself: a library track or an uploaded file, named by id only. */
export type MusicSource =
  | { kind: 'track'; id: string; name: string; duration: number }
  | { kind: 'upload'; id: string; name: string; duration: number };

export interface PickableTrack {
  id: string;
  title: string;
  duration: number;
  variant?: number | null;
}

export const UPLOAD_ACCEPT = '.wav,.mp3,.flac,.ogg,.m4a,audio/*';

/** The request fields that name *source* as the edit source or the style reference. */
export function sourceFields(
  source: MusicSource | null,
  role: 'source' | 'reference',
): Record<string, string> {
  if (!source) return {};
  return { [`${role}_${source.kind === 'track' ? 'track' : 'upload'}_id`]: source.id };
}

export function MusicSourcePicker({
  id,
  label,
  hint,
  tracks,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  tracks: PickableTrack[];
  value: MusicSource | null;
  disabled?: boolean;
  onChange: (source: MusicSource | null) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const trackLabel = (track: PickableTrack) =>
    track.variant
      ? `${track.title} · ${t('musicStudio.variant_label', { n: track.variant })}`
      : track.title;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const stored = await apiJson<{ upload_id: string; name: string; duration: number }>(
        '/music/upload',
        { method: 'POST', body: form },
      );
      onChange({
        kind: 'upload',
        id: stored.upload_id,
        name: file.name,
        duration: stored.duration,
      });
    } catch (error) {
      toast.error(t('musicStudio.upload_failed', { message: describeError(error) }));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-label">
      {hint ? (
        <TitleWithHelp id={`${id}-label`} title={label} help={hint} />
      ) : (
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
      )}
      {value ? (
        <div className="flex min-w-0 items-center gap-2 rounded-(--control-radius) border border-input bg-control-fill px-2 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate" title={value.name}>
            {value.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t('musicStudio.duration_value', { seconds: Math.round(value.duration) })}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={disabled}
            aria-label={t('musicStudio.source_clear')}
            onClick={() => onChange(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 gap-1.5">
          <Select
            value=""
            disabled={disabled || tracks.length === 0}
            onValueChange={(next) => {
              const track = tracks.find((item) => item.id === next);
              if (track)
                onChange({
                  kind: 'track',
                  id: track.id,
                  name: trackLabel(track),
                  duration: track.duration,
                });
            }}
          >
            <SelectTrigger aria-labelledby={`${id}-label`} className="min-w-0 flex-1">
              <SelectValue>
                {tracks.length
                  ? t('musicStudio.source_from_library')
                  : t('musicStudio.source_library_empty')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tracks.map((track) => (
                <SelectItem key={track.id} value={track.id}>
                  {trackLabel(track)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={disabled || uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? (
              <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
            ) : (
              <UploadIcon />
            )}
            {t('musicStudio.source_upload')}
          </Button>
          <input
            ref={input}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
      )}
    </div>
  );
}
