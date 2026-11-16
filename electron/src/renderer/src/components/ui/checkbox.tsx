"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"
import { cn } from "cn"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-(--background) transition-[color,background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-control-fill dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current"
      >
        <CheckIcon className="size-3.5" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
