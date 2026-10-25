import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CaptionsOffIcon, DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { apiJson, describeError } from '@/lib/api/client';
import { consumeTaskStream } from '@/lib/api/event-stream';

/** Optional first-run card: installs the on-screen subtitle engine now instead of on first use. */
export function SetupHardsubEngine() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const [log, setLog] = useState('');
  const status = useQuery({
    queryKey: ['hardsub-status'],
    queryFn: () => apiJson<{ installed: boolean }>('/dub/hardsub/status'),
    staleTime: 30_000,
    retry: false,
  });
  if (status.isPending || status.isError || status.data?.installed) return null;

  const install = async () => {
    setProgress(0);
    setLog('');
    try {
      await consumeTaskStream('/dub/hardsub/install-stream', (event) => {
        if (event.type === 'progress') setProgress(Number(event.progress) || 0);
        if (event.type === 'log') setLog(String(event.message || ''));
        if (event.type === 'error') throw new Error(String(event.reason || 'Install failed'));
        return event.type === 'done';
      });
      await queryClient.invalidateQueries({ queryKey: ['hardsub-status'] });
      toast.success(t('dub_hardsub.installed'));
    } catch (error) {
      toast.error(t('dub_hardsub.install_failed', { message: describeError(error) }));
    } finally {
      setProgress(null);
    }
  };

  const installing = progress !== null;
  return (
    <section className="space-y-2 rounded-lg border border-border/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <CaptionsOffIcon className="size-4" aria-hidden="true" />
        {t('dub_hardsub.title')} · {t('firstrun.chip_optional')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('dub_hardsub.install_help')}</p>
      <Button size="sm" variant="outline" disabled={installing} onClick={install}>
        {installing ? (
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon className="size-4" aria-hidden="true" />
        )}
        {t('dub_hardsub.install')}
      </Button>
      {installing && (
        <div className="space-y-1">
          <Progress value={Math.round((progress ?? 0) * 100)} aria-label={t('dub_hardsub.install')} />
          {log && <p className="truncate font-mono text-[10px] text-muted-foreground">{log}</p>}
        </div>
      )}
    </section>
  );
}
