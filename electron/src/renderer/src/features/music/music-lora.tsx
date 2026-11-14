import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileIcon, FolderOpenIcon, Trash2Icon } from 'lucide-react';
import { getBridge } from '@/components/bridge';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { apiJson, describeError } from '@/lib/api/client';
import type { DitModel } from './music-options';

/** `GET /music/lora`: the LoRA picked in the desktop app; the backend never returns its path. */
export interface LoraState {
  selected: boolean;
  name?: string;
  kind?: 'file' | 'folder';
  scale?: number;
  enabled?: boolean;
  model?: DitModel;
  available?: boolean;
}

const QUERY_KEY = ['music-lora'];

/**
 * LoRA for Music Studio (desktop only). The file or folder comes from Electron main's native
 * picker as a one-shot grant; the renderer only forwards the grant token, never a path.
 */
export function MusicLora({ model, disabled }: { model: DitModel; disabled: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const bridge = getBridge();
  const pickable = Boolean(bridge?.files?.authorizeMusicLora);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The slider moves locally while dragged and is saved when released.
  const [dragScale, setDragScale] = useState<number | null>(null);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiJson<LoraState>('/music/lora'),
  });
  const lora = query.data;
  if (!pickable && !lora?.selected) return null;

  const run = async (action: () => Promise<LoraState | null>) => {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      if (next) client.setQueryData(QUERY_KEY, next);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const pick = (kind: 'file' | 'folder') =>
    run(async () => {
      const grant = await bridge?.files.authorizeMusicLora(kind);
      if (!grant) return null;
      return apiJson<LoraState>('/music/lora', {
        method: 'POST',
        body: JSON.stringify({ authorization: grant.authorization, model }),
      });
    });
  const change = (body: { scale?: number; enabled?: boolean }) =>
    run(() => apiJson<LoraState>('/music/lora', { method: 'PATCH', body: JSON.stringify(body) }));
  const off = disabled || busy;

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="space-y-1">
        <span className="font-medium">{t('musicStudio.lora')}</span>
        <p className="leading-5 text-muted-foreground">{t('musicStudio.lora_help')}</p>
      </div>
      {lora?.selected ? (
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium" title={lora.name}>
              {lora.name}
            </span>
            <Switch
              checked={Boolean(lora.enabled)}
              disabled={off}
              aria-label={t('musicStudio.lora_enabled')}
              onCheckedChange={(enabled) => change({ enabled })}
            />
          </label>
          <Reveal>
            {lora.available === false && (
              <p role="alert" className="leading-5 text-destructive">
                {t('musicStudio.lora_missing')}
              </p>
            )}
          </Reveal>
          {lora.model && lora.model !== model && (
            <p className="leading-5 text-muted-foreground">
              {t('musicStudio.lora_model_mismatch', {
                picked: t(`musicStudio.model_${lora.model}`),
                current: t(`musicStudio.model_${model}`),
              })}
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t('musicStudio.lora_scale')}</span>
              <span className="text-muted-foreground tabular-nums">
                {Math.round((dragScale ?? lora.scale ?? 1) * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[dragScale ?? lora.scale ?? 1]}
              disabled={off || !lora.enabled}
              aria-label={t('musicStudio.lora_scale')}
              onValueChange={(value) => setDragScale(Array.isArray(value) ? value[0] : value)}
              onValueCommitted={(value) => {
                setDragScale(null);
                void change({ scale: Array.isArray(value) ? value[0] : value });
              }}
            />
          </div>
          <Button
            size="xs"
            variant="ghost"
            disabled={off}
            onClick={() => run(() => apiJson<LoraState>('/music/lora', { method: 'DELETE' }))}
          >
            <Trash2Icon />
            {t('musicStudio.lora_remove')}
          </Button>
        </div>
      ) : null}
      {pickable && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" disabled={off} onClick={() => pick('file')}>
            <FileIcon />
            {t('musicStudio.lora_pick_file')}
          </Button>
          <Button size="xs" variant="secondary" disabled={off} onClick={() => pick('folder')}>
            <FolderOpenIcon />
            {t('musicStudio.lora_pick_folder')}
          </Button>
        </div>
      )}
      <Reveal>
        {error && (
          <p role="alert" className="leading-5 text-destructive">
            {error}
          </p>
        )}
      </Reveal>
    </div>
  );
}
