import { CheckCircle2Icon, LogInIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GeminiAccountStatus } from '../../../../preload/index.d';

type Phase = 'checking' | 'idle' | 'starting' | 'awaitingCode' | 'submitting';

/**
 * Google sign-in state for Gemini through the Antigravity CLI. Checking lists
 * models from Google, so it runs when this card opens or on "Check again",
 * never in the background.
 */
export function GeminiAccount({
  model,
  disabled,
  onPickModel,
}: {
  model: string;
  disabled?: boolean;
  onPickModel: (id: string) => void;
}) {
  const { t } = useTranslation();
  const bridge = window.voicestudio?.repair;
  const [status, setStatus] = useState<GeminiAccountStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [code, setCode] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const check = useCallback(async () => {
    if (!bridge?.geminiStatus) return;
    setPhase('checking');
    setError(null);
    try {
      const next = await bridge.geminiStatus();
      if (alive.current) setStatus(next);
    } catch {
      if (alive.current) setStatus({ installed: true, state: 'unknown', models: [] });
    } finally {
      if (alive.current) setPhase('idle');
    }
  }, [bridge]);

  useEffect(() => {
    alive.current = true;
    void check();
    return () => {
      alive.current = false;
      void bridge?.geminiLoginCancel?.().catch(() => {});
    };
  }, [bridge, check]);

  if (!bridge?.geminiStatus) return null;

  const startLogin = async () => {
    setPhase('starting');
    setError(null);
    setCode('');
    try {
      const started = await bridge.geminiLoginStart();
      if (!alive.current) return;
      setLoginUrl(started.url);
      setPhase('awaitingCode');
    } catch {
      if (!alive.current) return;
      setError('settings.gemini_login_failed');
      setPhase('idle');
    }
  };
  const submit = async () => {
    setPhase('submitting');
    setError(null);
    try {
      const next = await bridge.geminiLoginSubmit(code.trim());
      if (!alive.current) return;
      setStatus(next);
      setCode('');
      setLoginUrl('');
      setPhase('idle');
      if (next.state !== 'signedIn') setError('settings.gemini_login_failed');
    } catch {
      if (!alive.current) return;
      setError('settings.gemini_code_rejected');
      setLoginUrl('');
      setPhase('idle');
    }
  };
  const cancel = () => {
    void bridge.geminiLoginCancel().catch(() => {});
    setCode('');
    setLoginUrl('');
    setPhase('idle');
  };

  const state = status?.state;
  const message =
    phase === 'checking'
      ? 'settings.gemini_checking'
      : !status
        ? 'settings.gemini_checking'
        : !status.installed
          ? 'settings.gemini_not_installed'
          : state === 'signedIn'
            ? 'settings.gemini_signed_in'
            : state === 'signedOut'
              ? 'settings.gemini_signed_out'
              : 'settings.gemini_unknown';

  return (
    <div data-slot="gemini-account" className="space-y-3 px-4 py-3">
      <p
        role="status"
        className={
          state === 'signedIn' && phase !== 'checking'
            ? 'flex items-center gap-2 text-sm'
            : 'text-sm text-muted-foreground'
        }
      >
        {state === 'signedIn' && phase !== 'checking' && (
          <CheckCircle2Icon className="size-4 text-primary" aria-hidden />
        )}
        {t(message)}
      </p>
      {phase === 'awaitingCode' || phase === 'submitting' ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('settings.gemini_paste_code')}</p>
          {loginUrl && (
            <p className="break-all text-xs text-muted-foreground" data-slot="gemini-login-url">
              {loginUrl}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label={t('settings.gemini_code')}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1"
              value={code}
              disabled={phase === 'submitting'}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && code.trim()) void submit();
              }}
            />
            <Button
              size="sm"
              disabled={!code.trim() || phase === 'submitting'}
              onClick={() => void submit()}
            >
              {t('settings.gemini_finish_login')}
            </Button>
            <Button size="sm" variant="ghost" disabled={phase === 'submitting'} onClick={cancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status?.installed && state !== 'signedIn' && (
            <Button size="sm" disabled={phase !== 'idle'} onClick={() => void startLogin()}>
              <LogInIcon />
              {t('settings.gemini_sign_in')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={phase !== 'idle'}
            onClick={() => void check()}
          >
            <RefreshCwIcon />
            {t('settings.gemini_check')}
          </Button>
        </div>
      )}
      <Reveal>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
      </Reveal>
      {state === 'signedIn' && status && status.models.length > 0 && phase !== 'checking' && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('settings.gemini_models')}</p>
          <div className="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant={model ? 'ghost' : 'secondary'}
              disabled={disabled}
              onClick={() => onPickModel('')}
            >
              {t('settings.gemini_model_default')}
            </Button>
            {status.models.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={model === item.id ? 'secondary' : 'ghost'}
                title={item.id}
                disabled={disabled}
                onClick={() => onPickModel(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
