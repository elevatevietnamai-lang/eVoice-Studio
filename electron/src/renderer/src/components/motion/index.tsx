import type { ReactNode } from 'react';
import { MotionConfig, motion, type HTMLMotionProps, type Variants } from 'motion/react';

/**
 * Motion tokens from the Elevate brand (DESIGN.md): quiet, short, never blocking.
 * Seconds, for the `motion` library; the CSS twins are 160 / 240 / 480 ms.
 */
export const motionTokens = {
  fast: 0.16,
  base: 0.24,
  slow: 0.48,
  ease: [0.22, 1, 0.36, 1],
} as const;

/** App-wide defaults. `reducedMotion="user"` makes every motion component honor the OS setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: motionTokens.base, ease: motionTokens.ease }}
    >
      {children}
    </MotionConfig>
  );
}

const offsets = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  none: { x: 0, y: 0 },
} as const;

interface FadeInProps extends Omit<HTMLMotionProps<'div'>, 'initial' | 'animate'> {
  /** Which side the content drifts in from. */
  direction?: keyof typeof offsets;
  /** Pixels of drift; keep it small. */
  distance?: number;
  delay?: number;
}

/** Fades content in on mount with a short drift. Under reduced motion it only fades. */
export function FadeIn({
  direction = 'up',
  distance = 8,
  delay = 0,
  transition,
  ...props
}: FadeInProps) {
  const offset = offsets[direction];
  return (
    <motion.div
      initial={{ opacity: 0, x: offset.x * distance, y: offset.y * distance }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ delay, ...transition }}
      {...props}
    />
  );
}

const staggerVariants: Variants = {
  hidden: {},
  visible: (stagger: number) => ({ transition: { staggerChildren: stagger } }),
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

interface StaggerProps extends Omit<
  HTMLMotionProps<'div'>,
  'variants' | 'initial' | 'animate' | 'custom'
> {
  /** Seconds between children. */
  stagger?: number;
}

/** Container that reveals its `StaggerItem` children one after another on mount. */
export function Stagger({ stagger = 0.04, ...props }: StaggerProps) {
  return (
    <motion.div
      variants={staggerVariants}
      initial="hidden"
      animate="visible"
      custom={stagger}
      {...props}
    />
  );
}

export function StaggerItem(props: Omit<HTMLMotionProps<'div'>, 'variants'>) {
  return <motion.div variants={itemVariants} {...props} />;
}

/**
 * A page switch settles in from 60% opacity over 120 ms, never from blank: the old page has no
 * exit, so a fade from 0 flashed the empty background. The control panel column runs the same
 * fade (`.secondary-sidebar` in globals.css) so both columns change together. Enter only, opacity
 * only, so layout and scroll never jump; keyed on the top-level segment so nested pages keep state.
 */
export const ROUTE_FADE_FROM = 0.6;
export const ROUTE_FADE_SECONDS = 0.12;

export function RouteFade({ segment, children }: { segment: string; children: ReactNode }) {
  return (
    <motion.div
      key={segment}
      className="h-full min-h-0"
      initial={{ opacity: ROUTE_FADE_FROM }}
      animate={{ opacity: 1 }}
      transition={{ duration: ROUTE_FADE_SECONDS, ease: motionTokens.ease }}
    >
      {children}
    </motion.div>
  );
}

/** Ease-out cubic: it keeps moving through the last third, where ease-out quint has already stopped. */
const settle = [0.33, 1, 0.68, 1] as const;

const menuVariants: Variants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.08, staggerChildren: 0.06 } },
};
const menuItemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: settle },
  },
};

/**
 * The rail group menu's surface wipes open from the rail side over 280 ms and closes the same way
 * in 180 ms. It stays fully opaque (a clip, not a fade), so the page panel under it never shows
 * through, and it never pops in as an empty block before its items.
 */
export const menuSurfaceMotion = {
  initial: { clipPath: 'inset(0px 100% 0px 0px)' },
  animate: { clipPath: 'inset(0px 0% 0px 0px)', transition: { duration: 0.28, ease: settle } },
  exit: {
    clipPath: 'inset(0px 100% 0px 0px)',
    transition: { duration: 0.18, ease: [0.32, 0, 0.67, 0] },
  },
} as const;

/**
 * A menu's items settling in one after another (60 ms apart, 320 ms each, rising 6 px) while the
 * surface opens, slow enough to read as a cascade rather than a flash.
 */
export function MenuReveal(
  props: Omit<HTMLMotionProps<'nav'>, 'variants' | 'initial' | 'animate'>,
) {
  return <motion.nav variants={menuVariants} initial="hidden" animate="visible" {...props} />;
}

export function MenuRevealItem(props: Omit<HTMLMotionProps<'div'>, 'variants'>) {
  return <motion.div variants={menuItemVariants} {...props} />;
}
