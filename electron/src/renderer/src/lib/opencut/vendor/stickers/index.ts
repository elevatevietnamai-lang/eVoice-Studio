// Spike stub: stickers pull Iconify downloads and @hugeicons, which a local-first app does not ship.
export function resolveStickerId(_: { stickerId: string; [key: string]: unknown }): string {
  throw new Error('Stickers are not part of the OpenCut spike');
}
