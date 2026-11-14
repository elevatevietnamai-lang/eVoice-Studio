import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The eVoice Studio mark: four rounded white voice bars, a four-point star cut between the second
 * and third bar, and a white star above the last one. The paths are the same flattened geometry as
 * `docs/logo.svg`, in the mark's own 340-unit drawing space (ink box 30–309.5 × 15–325, centred on
 * the canvas).
 */
export const BARS = {
  /** The four bars with the star knocked out (a boolean difference, not a mask). */
  full: 'M101.5 44C101.5 27.984 114.484 15 130.5 15C146.516 15 159.5 27.984 159.5 44V150.171Q149.405 165.615 130.25 172Q149.405 178.385 159.5 193.829V296C159.5 312.016 146.516 325 130.5 325C114.484 325 101.5 312.016 101.5 296ZM173 120C173 103.984 185.984 91 202 91C218.016 91 231 103.984 231 120V225C231 241.016 218.016 254 202 254C185.984 254 173 241.016 173 225V193.829Q183.095 178.385 202.25 172Q183.095 165.615 173 150.171ZM30 124C30 107.984 42.984 95 59 95C75.016 95 88 107.984 88 124V215C88 231.016 75.016 244 59 244C42.984 244 30 231.016 30 215ZM244.5 161C244.5 144.984 257.484 132 273.5 132C289.516 132 302.5 144.984 302.5 161V184C302.5 200.016 289.516 213 273.5 213C257.484 213 244.5 200.016 244.5 184Z',
  /** Solid bars for 20 px and below, where the cut-out star would be a few blurred pixels. */
  small:
    'M101.5 44C101.5 27.984 114.484 15 130.5 15C146.516 15 159.5 27.984 159.5 44V296C159.5 312.016 146.516 325 130.5 325C114.484 325 101.5 312.016 101.5 296ZM173 120C173 103.984 185.984 91 202 91C218.016 91 231 103.984 231 120V225C231 241.016 218.016 254 202 254C185.984 254 173 241.016 173 225ZM30 124C30 107.984 42.984 95 59 95C75.016 95 88 107.984 88 124V215C88 231.016 75.016 244 59 244C42.984 244 30 231.016 30 215ZM244.5 161C244.5 144.984 257.484 132 273.5 132C289.516 132 302.5 144.984 302.5 161V184C302.5 200.016 289.516 213 273.5 213C257.484 213 244.5 200.016 244.5 184Z',
};
export const SPARK =
  'M273.5 42.5Q282.5 69.5 309.5 78.5Q282.5 87.5 273.5 114.5Q264.5 87.5 237.5 78.5Q264.5 69.5 273.5 42.5Z';
/** The mark is white; the tile is the app icon's near-black (`docs/logo.svg`). */
export const COLORS = { mark: '#FFFFFF', tile: '#030305' };
/** At this size and below, `cut="auto"` draws solid bars. */
export const SMALL_MAX = 20;
/**
 * On a tile the mark sits where the app icon puts it: `docs/logo.svg` draws it 37.5 of 64 units
 * tall with a 14.5/64 corner, and `docs/logo-small.svg` (32 px and below) 47.5/64 with 12.5/64, so
 * a small tile is not mostly empty. The 310-unit ink box scales by that share and stays centred.
 */
export const TILE = {
  full: { scale: 37.5 / 64, radius: (14.5 / 64) * 340 },
  small: { scale: 47.5 / 64, radius: (12.5 / 64) * 340 },
};
/** At this size and below a tiled mark uses the `docs/logo-small.svg` proportions. */
export const SMALL_TILE_MAX = 32;

export interface EVoiceMarkProps extends Omit<
  SVGProps<SVGSVGElement>,
  'viewBox' | 'width' | 'height'
> {
  /** Rendered size in px. */
  size?: number;
  /** Accessible name; without it the mark is decorative. */
  label?: string;
  /** `full` keeps the cut-out star at any size; `auto` drops it at 20 px and below. */
  cut?: 'auto' | 'full';
  /** `white` is the brand mark; `mono` draws in `currentColor` and never adds a tile. */
  tone?: 'white' | 'mono';
  /**
   * The near-black app-icon tile behind the white mark. `auto` shows it only in the light theme,
   * where a bare white mark would vanish; `always` matches the app icon in both themes.
   */
  tile?: 'auto' | 'always' | 'none';
}

export function EVoiceMark({
  size = 24,
  label,
  cut: cutMode = 'auto',
  tone = 'white',
  tile = 'auto',
  className,
  ...props
}: EVoiceMarkProps) {
  const small = cutMode === 'auto' && size <= SMALL_MAX;
  const white = tone === 'white';
  const tiled = white && tile !== 'none';
  const fill = white ? COLORS.mark : 'currentColor';
  const tileCut = size <= SMALL_TILE_MAX ? TILE.small : TILE.full;
  const tileOffset = 170 * (1 - tileCut.scale);
  const ink = (
    <>
      <path d={small ? BARS.small : BARS.full} fill={fill} />
      <path d={SPARK} fill={fill} />
    </>
  );
  return (
    <svg
      viewBox="0 0 340 340"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mark={small ? 'small' : 'full'}
      data-tone={tone}
      data-tile={tiled ? tile : 'none'}
      {...props}
    >
      {tiled ? (
        // In `auto` the tiled copy shows in the light theme and the bare copy in the dark one.
        <g data-part="tiled" className={cn(tile === 'auto' && 'dark:hidden')}>
          <rect width="340" height="340" rx={tileCut.radius} fill={COLORS.tile} />
          <g transform={`translate(${tileOffset} ${tileOffset}) scale(${tileCut.scale})`}>{ink}</g>
        </g>
      ) : null}
      {!tiled || tile === 'auto' ? (
        <g data-part="bare" className={cn(tiled && 'hidden dark:inline')}>
          {ink}
        </g>
      ) : null}
    </svg>
  );
}
