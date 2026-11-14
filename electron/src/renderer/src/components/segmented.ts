/**
 * Nested corners stay concentric (DESIGN.md): an inner corner equals the outer corner minus the
 * inset between them, so the two curves run parallel.
 *
 * - Segmented frame: 12 px frame, 4 px inset, 8 px items. The look of TabsList and ToggleGroup,
 *   for groups built from Buttons. Items keep the 8 px control corner, so they match every other
 *   button (a 4 px item read as square-cornered inside its rounded frame).
 * - Chip tray: 12 px card, 4 px inset, 8 px chips.
 *
 * Call sites add only layout (flex, grid, wrap, width); the frame sets its items' corners.
 */
export const segmentedFrameClass = 'gap-1 rounded-(--card-radius) bg-muted p-1 [&>*]:rounded-lg';

export const chipTrayClass =
  'gap-1 rounded-(--card-radius) border border-border/50 bg-muted/15 p-1 [&>*]:rounded-lg';
