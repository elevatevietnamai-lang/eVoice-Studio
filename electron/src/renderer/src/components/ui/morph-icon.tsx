import { MorphIcon as BaseMorphIcon, type MorphIconProps } from 'morphicons/react';
import { cn } from '@/lib/utils';

export type { IconNode } from 'morphicons/react';

/**
 * An icon that morphs into the next one when `icon` changes (menu to close, play to pause).
 *
 * Pass Lucide icon data, not a component: `import { Play } from 'lucide'`. Use it where an icon
 * changes state; static icons stay on `lucide-react`. It follows the OS reduced-motion setting and
 * keeps the 1.75 stroke the rest of the Lucide icons get from `globals.css`.
 */
export function MorphIcon({
  className,
  strokeWidth = 1.75,
  reducedMotion = 'user',
  spring = 'snappy',
  ...props
}: MorphIconProps) {
  return (
    <BaseMorphIcon
      className={cn('shrink-0', className)}
      strokeWidth={strokeWidth}
      reducedMotion={reducedMotion}
      spring={spring}
      {...props}
    />
  );
}
