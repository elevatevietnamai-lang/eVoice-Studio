import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface SimpleSelectItem<T extends string> {
  value: T;
  label: string;
}

/**
 * A short list of plain choices on the Select primitive, so it follows the theme's control
 * styles (DESIGN.md: no native select element).
 */
export function SimpleSelect<T extends string>({
  value,
  items,
  onValueChange,
  label,
  disabled,
  className,
}: {
  value: T;
  items: readonly SimpleSelectItem<T>[];
  onValueChange: (value: T) => void;
  /** Accessible name of the trigger. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const match = items.find((item) => item.value === next);
        if (match) onValueChange(match.value);
      }}
    >
      <SelectTrigger aria-label={label} size="sm" className={cn('min-w-24', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
