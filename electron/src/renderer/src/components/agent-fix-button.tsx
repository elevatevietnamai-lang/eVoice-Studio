import { WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { openRepairAgent } from '@/lib/repair-agent-events';
import { cn } from '@/lib/utils';

/**
 * Opens the repair agent with `request`. `size` matches the row it sits in (DESIGN.md, "Action rows
 * share one height"): `sm` beside 28 px buttons and links, `default` beside full-size ones.
 */
export function AgentFixButton({
  request,
  className,
  size = 'sm',
}: {
  request: string;
  className?: string;
  size?: 'sm' | 'default';
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      className={cn('shrink-0', className)}
      onClick={() => openRepairAgent(`ACTION_REQUEST: ${request}`, true)}
    >
      <WrenchIcon />
      {t('repairAgent.fix')}
    </Button>
  );
}
