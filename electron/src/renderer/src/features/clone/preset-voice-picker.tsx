import { useTranslation } from 'react-i18next';
import { useEngines } from '@/hooks/use-engines';
import { SimpleSelect } from '@/components/simple-select';
import { setCloneSetting, useCloneSettings } from '@/lib/store/clone-settings';

/** Built-in voices of engines that ship presets instead of cloning (e.g. Supertonic-3, #2938). */
export function PresetVoicePicker({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { activeTts } = useEngines();
  const settings = useCloneSettings();
  const voices = activeTts?.preset_voices ?? [];
  if (!voices.length) return null;
  const value = voices.includes(settings.presetVoice)
    ? settings.presetVoice
    : (activeTts?.default_voice ?? voices[0]);
  return (
    <div className="flex items-center gap-1.5 px-2 text-xs">
      <span className="text-muted-foreground">{t('presetVoice.label')}</span>
      <SimpleSelect
        label={t('presetVoice.label')}
        value={value}
        items={voices.map((voice) => ({ value: voice, label: voice }))}
        disabled={disabled}
        onValueChange={(voice) => setCloneSetting('presetVoice', voice)}
      />
    </div>
  );
}
