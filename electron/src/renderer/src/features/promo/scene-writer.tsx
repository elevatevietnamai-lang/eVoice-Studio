import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircleIcon, RefreshCwIcon, SparklesIcon, XIcon } from 'lucide-react';
import { ApiError, apiJson } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PromoScene } from './scene-model';

/** Mirrors backend/services/promo_scene_writer.py. */
export const MAX_DESCRIPTION = 2000;
export type WriterShape = 'overlay' | 'shot';
const SHAPES: readonly WriterShape[] = ['overlay', 'shot'];

export interface WriterProvider {
  ready: boolean;
  reason: 'disabled' | 'no_provider' | 'unconfigured' | null;
  provider_id: string | null;
  display_name: string | null;
  local: boolean | null;
  transport: string | null;
}

/** Refusal codes with their own sentence (`scene_writer:<code>` from the API). */
const KNOWN_ERRORS = new Set([
  'provider_changed',
  'provider_failed',
  'bad_reply',
  'too_large',
  'too_long',
]);

/** The provider stopped being usable: the panel shows why after a recheck. */
const NOT_READY = new Set(['disabled', 'no_provider', 'unconfigured']);

const errorCode = (error: unknown) => {
  const detail = error instanceof ApiError ? error.detail : '';
  return detail.startsWith('scene_writer:') ? detail.slice('scene_writer:'.length) : '';
};

export function writerErrorKey(error: unknown): string {
  const code = errorCode(error);
  return KNOWN_ERRORS.has(code) ? `promo.scene_ai_error_${code}` : 'promo.scene_ai_error_generic';
}

/**
 * "Write with AI": the description goes to the LLM provider the user set up in
 * Settings, and only after this panel has shown which one (by name, and
 * whether it runs on this machine). The request names that provider, so the
 * backend refuses rather than sending it anywhere else. The answer is loaded
 * as an unsaved draft: the editor's sandboxed preview and checks run on it
 * like on any imported scene, and nothing is saved or rendered by itself.
 */
export function SceneWriter({
  disabled,
  onScene,
}: {
  disabled: boolean;
  onScene: (scene: PromoScene) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<WriterProvider | null>(null);
  const [description, setDescription] = useState('');
  const [shape, setShape] = useState<WriterShape>('overlay');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    setProvider(null);
    try {
      setError(null);
      setProvider(await apiJson<WriterProvider>('/promo/scene-writer'));
    } catch {
      setError('promo.scene_ai_error_generic');
    }
  };

  useEffect(() => {
    if (open && !provider) void refresh();
    // Only when the panel opens; refresh() is stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
          <SparklesIcon />
          {t('promo.scene_ai_open')}
        </Button>
      </div>
    );
  }

  const write = async () => {
    if (!provider?.ready || !provider.provider_id) return;
    setWriting(true);
    setError(null);
    setNotice(null);
    try {
      const { scene } = await apiJson<{ scene: PromoScene }>('/promo/scene-writer', {
        method: 'POST',
        body: JSON.stringify({
          description: description.trim(),
          provider_id: provider.provider_id,
          shape,
          language: i18n.resolvedLanguage ?? i18n.language ?? 'en',
        }),
      });
      onScene({ ...scene, name: scene.name || t('promo.scene_ai_default_name') });
      setNotice(t('promo.scene_ai_done'));
    } catch (failure) {
      // The provider changed or went away: show the current one again.
      if (failure instanceof ApiError && failure.status === 409) void refresh();
      if (!NOT_READY.has(errorCode(failure))) setError(writerErrorKey(failure));
    } finally {
      setWriting(false);
    }
  };

  const destination = provider?.display_name
    ? t(provider.local ? 'promo.scene_ai_sends_local' : 'promo.scene_ai_sends_remote', {
        provider: provider.display_name,
      })
    : null;

  return (
    <section
      aria-label={t('promo.scene_ai_title')}
      className="space-y-2 border-y border-border py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-xs font-medium">
          <SparklesIcon className="size-3.5" />
          {t('promo.scene_ai_title')}
        </p>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('promo.scene_ai_close')}
          disabled={writing}
          onClick={() => setOpen(false)}
        >
          <XIcon />
        </Button>
      </div>
      {!provider && !error && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {t('promo.scene_ai_checking')}
        </p>
      )}
      {provider && !provider.ready && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {t(`promo.scene_ai_not_ready_${provider.reason ?? 'no_provider'}`, {
              provider: provider.display_name ?? '',
            })}
          </p>
          <Button size="xs" variant="ghost" onClick={() => void refresh()}>
            <RefreshCwIcon />
            {t('promo.scene_ai_recheck')}
          </Button>
        </div>
      )}
      {provider?.ready && (
        <>
          <p className="text-xs" data-testid="scene-ai-destination">
            {destination}
          </p>
          <Textarea
            aria-label={t('promo.scene_ai_description')}
            placeholder={t('promo.scene_ai_placeholder')}
            maxLength={MAX_DESCRIPTION}
            value={description}
            disabled={writing}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1">
            {SHAPES.map((option) => (
              <Button
                key={option}
                size="xs"
                aria-pressed={shape === option}
                variant={shape === option ? 'secondary' : 'ghost'}
                disabled={writing}
                onClick={() => setShape(option)}
              >
                {t(`promo.scene_ai_shape_${option}`)}
              </Button>
            ))}
            <Button
              size="sm"
              className="ml-auto"
              disabled={disabled || writing || !description.trim()}
              onClick={() => void write()}
            >
              {writing ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
              {writing ? t('promo.scene_ai_writing') : t('promo.scene_ai_write')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('promo.scene_ai_note')}</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
    </section>
  );
}
