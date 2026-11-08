/**
 * Surface and motion of every dropdown menu (Base UI `Menu.Popup`), so menus open like Popover
 * and Select: 12 px card corners, fade and scale from 97% over 200 ms in and 150 ms out from the
 * trigger (DESIGN.md). Call sites add only size and layout classes.
 */
export const menuPopupClass =
  'origin-(--transform-origin) rounded-(--card-radius) border border-border bg-popover text-popover-foreground shadow-md outline-none transition-[opacity,transform] duration-200 ease-(--ease-standard) data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:duration-150 data-ending-style:scale-[0.97] data-ending-style:opacity-0 motion-reduce:transition-none';
