/**
 * Surface and motion of every dropdown menu (Base UI `Menu.Popup`), so menus open like Popover
 * and Select: 12 px card corners, fade and scale from 97% over 200 ms in and 150 ms out from the
 * trigger (DESIGN.md). Call sites add only size and layout classes.
 */
export const menuPopupClass =
  'origin-(--transform-origin) rounded-(--card-radius) border border-border bg-popover text-popover-foreground shadow-md outline-none transition-[opacity,transform] duration-200 ease-(--ease-standard) data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:duration-150 data-ending-style:scale-[0.97] data-ending-style:opacity-0 motion-reduce:scale-100 motion-reduce:duration-150';

/**
 * Row of every dropdown menu (Base UI `Menu.Item`): 8 px corners inside the 12 px popup and its
 * `p-1` inset (concentric), and a flat `bg-accent` fill on `data-highlighted`, which Base UI sets
 * for the pointer and for keyboard moves alike (DESIGN.md). Required on each `Menu.Item`.
 */
export const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition-colors duration-160 select-none data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-accent data-highlighted:text-accent-foreground';

/**
 * Open and close motion for a hand-built popup kept mounted by `usePresence` (hooks/use-presence):
 * the same 200 ms in and 150 ms out, fade and scale from 95%, as the Base UI popups.
 */
export const presencePopupClass =
  'origin-top duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-150 data-[state=closed]:pointer-events-none motion-reduce:zoom-in-100 motion-reduce:zoom-out-100';
