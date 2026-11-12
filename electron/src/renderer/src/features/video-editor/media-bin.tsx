/** The project's files: upload, then add to the timeline at the playhead. */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CaptionsIcon,
  FileAudioIcon,
  ImageIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  TypeIcon,
  UploadIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiPath } from '@/lib/api/client';
import type { EditorMedia, EditorProject } from './project';
import { formatTime } from './format';

function Thumb({ media }: { media: EditorMedia }) {
  if (media.kind === 'image')
    return <img src={apiPath(media.url)} alt="" className="size-full object-cover" loading="lazy" />;
  if (media.kind === 'video')
    return <video src={`${apiPath(media.url)}#t=0.5`} muted preload="metadata" className="size-full object-cover" />;
  return <FileAudioIcon className="size-5 text-muted-foreground" aria-hidden />;
}

export function MediaBin({
  project,
  uploading,
  onUpload,
  onAdd,
  onAddText,
  captioning,
  onCaptions,
  missing,
}: {
  missing: ReadonlySet<string>;
  project: EditorProject;
  uploading: boolean;
  onUpload: (files: File[]) => void;
  onAdd: (media: EditorMedia, placement: 'main' | 'overlay') => void;
  onAddText: () => void;
  captioning: boolean;
  onCaptions: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="video/*,image/*,audio/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) onUpload(files);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <UploadIcon />}
          {t('editor.import')}
        </Button>
        <Button size="sm" variant="outline" onClick={onAddText}>
          <TypeIcon />
          {t('editor.add_text')}
        </Button>
        <Button size="sm" variant="outline" className="col-span-2" disabled={captioning} onClick={onCaptions}>
          {captioning ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <CaptionsIcon />}
          {t(captioning ? 'editor.captions_working' : 'editor.captions')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('editor.captions_hint')}</p>
      {project.media.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('editor.media_empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {project.media.map((media) => (
            <li key={media.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-1.5">
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
                <Thumb media={media} />
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-medium">{media.name}</p>
                <p className="text-muted-foreground tabular-nums">
                  {missing.has(media.id) ? (
                    <span className="text-destructive">{t('editor.media_missing')}</span>
                  ) : media.kind === 'image' ? (
                    t('editor.still')
                  ) : (
                    formatTime(media.duration ?? 0)
                  )}
                </p>
              </div>
              {media.kind !== 'audio' && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t('editor.add_overlay', { name: media.name })}
                  onClick={() => onAdd(media, 'overlay')}
                >
                  {media.kind === 'image' ? <ImageIcon /> : <LayersIcon />}
                </Button>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t('editor.add_to_timeline', { name: media.name })}
                onClick={() => onAdd(media, 'main')}
              >
                <PlusIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
