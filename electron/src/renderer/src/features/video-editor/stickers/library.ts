/**
 * The editor's stickers: shapes, arrows and frames drawn for eVoice Studio
 * (recolourable), and Fluent Emoji (MIT). All are bundled SVG, turned into
 * data URLs when drawn, so a sticker never downloads anything.
 *
 * A sticker id is `evoice:<name>` or `evoice:<name>:<rrggbb>` for a
 * recoloured shape.
 */
import { FLUENT_EMOJI } from './fluent-emoji';

export const STICKER_GROUPS = ['shapes', 'arrows', 'frames', 'emoji'] as const;
export type StickerGroup = (typeof STICKER_GROUPS)[number];

/** Pixels a sticker is drawn at before the compositor scales it: sharp at full HD. */
export const STICKER_SIZE = 1024;
export const DEFAULT_STICKER_COLOR = '#ffffff';

interface StickerArt {
  group: StickerGroup;
  viewBox: string;
  /** SVG content; `currentColor` takes the sticker's colour. */
  body: string;
  recolor: boolean;
}

/** A five-pointed star centred in a 100-unit box. */
function starPoints(): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? 21 : 48;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(50 + radius * Math.cos(angle)).toFixed(2)},${(52 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

const SHAPE = (body: string): StickerArt => ({ group: 'shapes', viewBox: '0 0 100 100', body, recolor: true });
const ARROW = (body: string): StickerArt => ({ group: 'arrows', viewBox: '0 0 100 100', body, recolor: true });
const FRAME = (body: string): StickerArt => ({ group: 'frames', viewBox: '0 0 100 100', body, recolor: true });
const OUTLINE = (width = 5) =>
  `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;

const DRAWN: Record<string, StickerArt> = {
  circle: SHAPE('<circle cx="50" cy="50" r="47" fill="currentColor"/>'),
  square: SHAPE('<rect x="3" y="3" width="94" height="94" fill="currentColor"/>'),
  'rounded-square': SHAPE('<rect x="3" y="3" width="94" height="94" rx="18" fill="currentColor"/>'),
  triangle: SHAPE('<path d="M50 5 L96 90 H4 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'),
  star: SHAPE(`<polygon points="${starPoints()}" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`),
  heart: SHAPE('<path d="M50 89 C20 66 4 49 4 31 C4 16 15 6 29 6 C39 6 46 12 50 20 C54 12 61 6 71 6 C85 6 96 16 96 31 C96 49 80 66 50 89 Z" fill="currentColor"/>'),
  'arrow-right': ARROW('<path d="M6 41 H60 V20 L95 50 L60 80 V59 H6 Z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'),
  'arrow-curved': ARROW(`<path d="M12 82 C14 44 40 26 74 26" ${OUTLINE(9)}/><path d="M62 8 L92 26 L62 44 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>`),
  'arrow-double': ARROW('<path d="M4 50 L30 22 V40 H70 V22 L96 50 L70 78 V60 H30 V78 Z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'),
  'arrow-pointer': ARROW(`<path d="M20 10 L80 50 L20 90" ${OUTLINE(12)}/>`),
  'frame-square': FRAME(`<rect x="5" y="5" width="90" height="90" ${OUTLINE()}/>`),
  'frame-rounded': FRAME(`<rect x="5" y="5" width="90" height="90" rx="16" ${OUTLINE()}/>`),
  'frame-circle': FRAME(`<circle cx="50" cy="50" r="45" ${OUTLINE()}/>`),
  'frame-corners': FRAME(
    `<path d="M5 28 V5 H28 M72 5 H95 V28 M95 72 V95 H72 M28 95 H5 V72" ${OUTLINE(6)}/>`,
  ),
  'speech-bubble': FRAME(
    '<path d="M14 10 H86 Q95 10 95 19 V61 Q95 70 86 70 H44 L24 90 L28 70 H14 Q5 70 5 61 V19 Q5 10 14 10 Z" fill="currentColor"/>',
  ),
  banner: FRAME('<path d="M2 32 H20 V24 H80 V32 H98 L88 52 L98 72 H80 V80 H20 V72 H2 L12 52 Z" fill="currentColor"/>'),
};

const EMOJI: Record<string, StickerArt> = Object.fromEntries(
  Object.entries(FLUENT_EMOJI).map(([name, body]) => [
    `emoji-${name}`,
    { group: 'emoji', viewBox: '0 0 32 32', body, recolor: false },
  ]),
);

const ART: Record<string, StickerArt> = { ...DRAWN, ...EMOJI };

/** Sticker names in a group, in the order the picker shows them. */
export function stickersIn(group: StickerGroup): string[] {
  return Object.keys(ART).filter((name) => ART[name].group === group);
}

export function stickerId(name: string, color?: string): string {
  return color && ART[name]?.recolor ? `evoice:${name}:${color.replace('#', '').toLowerCase()}` : `evoice:${name}`;
}

export function parseStickerId(id: string): { name: string; color: string | null } | null {
  const match = /^evoice:([a-z0-9-]+)(?::([0-9a-f]{6}))?$/.exec(id);
  if (!match || !ART[match[1]]) return null;
  return { name: match[1], color: match[2] ? `#${match[2]}` : null };
}

export function isRecolorable(id: string): boolean {
  const parsed = parseStickerId(id);
  return !!parsed && ART[parsed.name].recolor;
}

/** The sticker as a standalone SVG document at STICKER_SIZE pixels. */
export function stickerSvg(id: string): string | null {
  const parsed = parseStickerId(id);
  if (!parsed) return null;
  const art = ART[parsed.name];
  const color = art.recolor ? (parsed.color ?? DEFAULT_STICKER_COLOR) : 'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STICKER_SIZE}" height="${STICKER_SIZE}" viewBox="${art.viewBox}" color="${color}">${art.body}</svg>`;
}

/** A data URL of the sticker, for the renderer and the picker. */
export function stickerUrl(id: string): string | null {
  const svg = stickerSvg(id);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}

export const stickerGroupOf = (id: string): StickerGroup | null => {
  const parsed = parseStickerId(id);
  return parsed ? ART[parsed.name].group : null;
};
