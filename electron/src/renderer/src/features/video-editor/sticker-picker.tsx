/** Bundled stickers (shapes, arrows, frames, emoji) to add at the playhead. */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { STICKER_GROUPS, stickerId, stickerUrl, stickersIn, type StickerGroup } from './stickers/library';

export function StickerPicker({ onAdd }: { onAdd: (id: string, name: string) => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<StickerGroup>('shapes');
  return (
    <section className="space-y-2" aria-label={t('editor.stickers')}>
      <h3 className="text-xs font-medium">{t('editor.stickers')}</h3>
      <div className="flex flex-wrap gap-1">
        {STICKER_GROUPS.map((item) => (
          <Button
            key={item}
            size="xs"
            variant={group === item ? 'secondary' : 'ghost'}
            aria-pressed={group === item}
            onClick={() => setGroup(item)}
          >
            {t(`editor.sticker_${item}`)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {stickersIn(group).map((name, index) => {
          const id = stickerId(name);
          // Named by group and number, so every language gets a label.
          const label = `${t(`editor.sticker_${group}`)} ${index + 1}`;
          return (
            <button
              key={name}
              type="button"
              className="flex aspect-square items-center justify-center rounded-sm border border-border/60 bg-muted p-1.5 hover:border-border"
              aria-label={t('editor.sticker_add', { name: label })}
              onClick={() => onAdd(id, label)}
            >
              <img src={stickerUrl(id) ?? undefined} alt="" className="size-full object-contain" draggable={false} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
