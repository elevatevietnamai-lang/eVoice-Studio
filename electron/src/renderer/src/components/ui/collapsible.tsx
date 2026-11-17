"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

/**
 * The bordered disclosure frame (`framed`). It sits inside a panel next to
 * fields, so it takes the control radius, 8 px, not the card radius
 * (DESIGN.md → Radius). Call sites never pick a frame radius themselves.
 */
const collapsibleFrameClass = "rounded-lg border border-border/60"

function Collapsible({
  framed = false,
  className,
  ...props
}: CollapsiblePrimitive.Root.Props & { framed?: boolean }) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={
        typeof className === "function"
          ? className
          : cn(framed && collapsibleFrameClass, className)
      }
      {...props}
    />
  )
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-240 data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0",
        typeof className === "function" ? undefined : className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent, collapsibleFrameClass }
