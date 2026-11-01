import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';

// Thin shadcn-styled wrapper over Base UI Popover: the generated ui/ set has
// no popover, and this keeps the same look as ui/select's popup.
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'anchor'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
        className="isolate z-50 outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'origin-(--transform-origin) rounded-lg surface-glass text-popover-foreground shadow-md ring-1 ring-border outline-none transition-[opacity,transform] duration-200 ease-(--ease-standard) data-ending-style:duration-150 data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0 motion-reduce:transition-none',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
