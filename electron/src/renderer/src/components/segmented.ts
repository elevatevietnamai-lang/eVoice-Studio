/**
 * Nested corners stay concentric (DESIGN.md): an inner corner equals the outer corner minus the
 * inset between them, so the two curves run parallel.
 *
 * - Segmented frame: 8 px frame, 4 px inset, 4 px items. The look of TabsList and ToggleGroup,
 *   for groups built from Buttons.
 * - Chip tray: 12 px card, 4 px inset, 8 px chips.
 *
 * Call sites add only layout (flex, grid, wrap, width); the frame sets its items' corners.
 */
export const segmentedFrameClass = 'gap-1 rounded-lg bg-muted p-1 [&>*]:rounded-sm';

export const chipTrayClass =
  'gap-1 rounded-(--card-radius) border border-border/50 bg-muted/15 p-1 [&>*]:rounded-lg';
