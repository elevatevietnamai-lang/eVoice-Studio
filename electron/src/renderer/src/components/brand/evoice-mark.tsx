import type { SVGProps } from 'react';

/**
 * The eVoice Studio mark: a dot and a voice waveform, drawn in `currentColor` so it follows the
 * theme. Geometry comes from the brand kit (eVoice-brand/kit/svg): the full mark above 32 px and
 * the thicker small cut at 32 px and below, where the fine hump would blur.
 */
/**
 * `shift` places the drawing on its optical centre, not its bounding box: the tall waveform peaks
 * sit right of the box centre and the dot is small, so a box-centred mark reads as pushed right.
 * Each cut is moved so the midpoint between its box centre and its ink centroid lands on the
 * canvas centre (128, 128); `evoice-mark.test.tsx` recomputes this from the geometry.
 */
export const FULL = {
  dot: { cx: 42, cy: 176, r: 9.5 },
  wave: 'M70 174C77.9 174 84.1 150 92 150C99.9 150 106.1 182 114 182C124.8 182 133.2 56 144 56C154.1 56 161.9 200 172 200C182.1 200 189.9 80 200 80C209.4 80 216.6 146 226 146',
  stroke: 17,
  shift: { x: -15, y: -2 },
};
export const SMALL = {
  dot: { cx: 40, cy: 180, r: 14 },
  wave: 'M78 178C89.6 178 100.4 66 112 66C124.2 66 135.8 202 148 202C159.6 202 170.4 84 182 84C192.9 84 203.1 150 214 150',
  stroke: 27,
  shift: { x: -4, y: -5 },
};

export interface EVoiceMarkProps extends Omit<
  SVGProps<SVGSVGElement>,
  'viewBox' | 'width' | 'height'
> {
  /** Rendered size in px. */
  size?: number;
  /** Accessible name; without it the mark is decorative. */
  label?: string;
  /** `full` keeps the app icon's own drawing at any size (kit `mark-white.svg`); `auto` switches to
   * the small cut at 32 px and below. */
  cut?: 'auto' | 'full';
}

export function EVoiceMark({
  size = 24,
  label,
  cut: cutMode = 'auto',
  className,
  ...props
}: EVoiceMarkProps) {
  const small = cutMode === 'auto' && size <= 32;
  const cut = small ? SMALL : FULL;
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mark={small ? 'small' : 'full'}
      {...props}
    >
      <g transform={`translate(${cut.shift.x} ${cut.shift.y})`}>
        <circle {...cut.dot} fill="currentColor" />
        <path
          d={cut.wave}
          fill="none"
          stroke="currentColor"
          strokeWidth={cut.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
