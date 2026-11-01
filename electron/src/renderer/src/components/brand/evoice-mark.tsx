import type { SVGProps } from 'react';

/**
 * The eVoice Studio mark: a dot and a voice waveform, drawn in `currentColor` so it follows the
 * theme. Geometry comes from the brand kit (eVoice-brand/kit/svg): the full mark above 32 px and
 * the thicker small cut at 32 px and below, where the fine hump would blur.
 */
const FULL = {
  dot: { cx: 42, cy: 176, r: 9.5 },
  wave: 'M70 174C77.9 174 84.1 150 92 150C99.9 150 106.1 182 114 182C124.8 182 133.2 56 144 56C154.1 56 161.9 200 172 200C182.1 200 189.9 80 200 80C209.4 80 216.6 146 226 146',
  stroke: 17,
  shift: -5,
};
const SMALL = {
  dot: { cx: 40, cy: 180, r: 14 },
  wave: 'M78 178C89.6 178 100.4 66 112 66C124.2 66 135.8 202 148 202C159.6 202 170.4 84 182 84C192.9 84 203.1 150 214 150',
  stroke: 27,
  shift: -6,
};

export interface EVoiceMarkProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height'> {
  /** Rendered size in px. */
  size?: number;
  /** Accessible name; without it the mark is decorative. */
  label?: string;
}

export function EVoiceMark({ size = 24, label, className, ...props }: EVoiceMarkProps) {
  const cut = size <= 32 ? SMALL : FULL;
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-mark={size <= 32 ? 'small' : 'full'}
      {...props}
    >
      <g transform={`translate(${cut.shift} 0)`}>
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
