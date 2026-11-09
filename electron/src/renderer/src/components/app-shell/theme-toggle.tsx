import { Moon, Sun } from 'lucide';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { MorphIcon } from '@/components/ui/morph-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/use-theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? t('app.switch_to_light') : t('app.switch_to_dark');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag"
            aria-label={label}
            onClick={() => setTheme(next)}
          />
        }
      >
        <MorphIcon icon={theme === 'dark' ? Sun : Moon} />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
