import { useId, type SVGProps } from 'react';

/**
 * The eVoice Studio mark: four rounded voice bars in an orange-to-pink gradient, a four-point star
 * cut between the second and third bar, and an orange star above the last one. The paths are the
 * same flattened geometry as `docs/logo.svg`, in the mark's own 340-unit drawing space (ink box
 * 30–309.5 × 15–325, centred on the canvas).
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
export const COLORS = { top: '#F8981D', bottom: '#FF32A3', spark: '#F88537' };
/** At this size and below, `cut="auto"` draws solid bars. */
export const SMALL_MAX = 20;

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
  /** `color` uses the brand gradient; `mono` draws in `currentColor` to follow the theme. */
  tone?: 'color' | 'mono';
}

export function EVoiceMark({
  size = 24,
  label,
  cut: cutMode = 'auto',
  tone = 'color',
  className,
  ...props
}: EVoiceMarkProps) {
  // Each instance owns its gradient id: a shared id breaks when the first copy is hidden.
  const gradient = `evoice-bars-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const small = cutMode === 'auto' && size <= SMALL_MAX;
  const color = tone === 'color';
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
      {...props}
    >
      {color ? (
        <defs>
          <linearGradient id={gradient} x1="0" y1="15" x2="0" y2="325" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={COLORS.top} />
            <stop offset="1" stopColor={COLORS.bottom} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={small ? BARS.small : BARS.full} fill={color ? `url(#${gradient})` : 'currentColor'} />
      <path d={SPARK} fill={color ? COLORS.spark : 'currentColor'} />
    </svg>
  );
}
