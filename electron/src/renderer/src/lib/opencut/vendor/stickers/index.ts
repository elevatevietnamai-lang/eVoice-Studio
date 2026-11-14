// eVoice Studio: OpenCut's stickers pull Iconify downloads and @hugeicons, which a
// local-first app does not ship. The editor registers a resolver for its bundled
// stickers (data URLs) instead; any other id is refused.
type StickerResolver = (stickerId: string) => string | null;

let resolver: StickerResolver | null = null;

export function setStickerResolver(next: StickerResolver): void {
  resolver = next;
}

export function resolveStickerId({ stickerId }: { stickerId: string; [key: string]: unknown }): string {
  const url = resolver?.(stickerId);
  if (!url) throw new Error(`Unknown sticker: ${stickerId}`);
  return url;
}
