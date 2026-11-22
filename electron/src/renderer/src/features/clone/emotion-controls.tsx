import { CircleHelpIcon, SmileIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/popover';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useEngines } from '@/hooks/use-engines';
import { patchCloneSettings, setCloneSetting, useCloneSettings } from '@/lib/store/clone-settings';
import { cn } from '@/lib/utils';

/**
 * Strongest emotion the engine applies from a description: IndexTTS2 caps text-led emotion at
 * 0.6 (backend/engines/indextts/__init__.py), so the slider stops there and reads as 0–100 %.
 */
export const EMOTION_MAX_ALPHA = 0.6;

/** One-tap starting points. The description the engine reads stays in English. */
export const EMOTION_PRESETS = [
  { key: 'warm', text: 'warm, gentle and sincere' },
  { key: 'cheerful', text: 'cheerful and bright' },
  { key: 'excited', text: 'excited and energetic' },
  { key: 'calm', text: 'calm and soothing' },
  { key: 'proud', text: 'confident and proud' },
  { key: 'sad', text: 'sad and quiet' },
] as const;

export const EMOTION_TEXT_MAX = 500;

/**
 * Composer button for a described emotion. Shown only when the active engine applies one
 * (`supports_emotion`, IndexTTS2); every other engine renders as before.
 */
export function EmotionControls({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { activeTts } = useEngines();
  const settings = useCloneSettings();
  const titleId = useId();
  const textId = useId();
  const strengthId = useId();
  // Local, not persisted: a remembered open state would pop the panel over other pages.
  const [open, setOpen] = useState(false);
  if (!activeTts?.supports_emotion) return null;

  const active = settings.emoText.trim() !== '';
  const strength = Math.min(EMOTION_MAX_ALPHA, Math.max(0, settings.emoAlpha));
  const percent = Math.round((strength / EMOTION_MAX_ALPHA) * 100);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={
          active ? `${t('clone.emotion')}: ${settings.emoText.trim()}` : t('clone.emotion')
        }
        title={t('clone.emotion')}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
          'relative text-muted-foreground hover:text-foreground data-popup-open:bg-secondary data-popup-open:text-foreground',
          active && 'text-primary hover:text-primary',
        )}
      >
        <SmileIcon />
        {active && (
          <span
            aria-hidden="true"
            data-slot="emotion-active"
            className="absolute top-2 right-2 size-1.5 rounded-full bg-primary"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        aria-labelledby={titleId}
        className="flex w-[min(380px,calc(100vw-32px))] flex-col gap-3 p-4"
      >
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h3 id={titleId} className="text-sm font-semibold">
              {t('clone.emotion')}
            </h3>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={t('clone.emotion_help')}
                    className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                }
              >
                <CircleHelpIcon className="size-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{t('clone.emotion_help')}</TooltipContent>
            </Tooltip>
          </div>
          {active && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('clone.emotion_clear')}
              title={t('clone.emotion_clear')}
              onClick={() => setCloneSetting('emoText', '')}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </header>

        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t('clone.emotion_presets_label')}
        >
          {EMOTION_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="xs"
              variant={settings.emoText.trim() === preset.text ? 'secondary' : 'outline'}
              aria-pressed={settings.emoText.trim() === preset.text}
              onClick={() => patchCloneSettings({ emoText: preset.text })}
            >
              {t(`clone.emotion_presets.${preset.key}`)}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={textId} className="text-xs font-medium">
            {t('audiobook.emotion_text')}
          </Label>
          <Input
            id={textId}
            value={settings.emoText}
            maxLength={EMOTION_TEXT_MAX}
            placeholder={t('audiobook.emotion_text_ph')}
            className="h-8 text-xs"
            onChange={(event) => setCloneSetting('emoText', event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span id={strengthId} className="text-xs font-medium">
              {t('audiobook.emotion_alpha')}
            </span>
            <output className="text-xs text-primary tabular-nums">{percent}%</output>
          </div>
          <Slider
            thumbProps={{ 'aria-labelledby': strengthId }}
            min={0.05}
            max={EMOTION_MAX_ALPHA}
            step={0.05}
            disabled={!active}
            value={[strength]}
            onValueChange={(next) => {
              const n = Array.isArray(next) ? next[0] : next;
              if (typeof n === 'number') setCloneSetting('emoAlpha', n);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
