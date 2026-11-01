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

interface StaggerProps extends Omit<HTMLMotionProps<'div'>, 'variants' | 'initial' | 'animate' | 'custom'> {
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
 * Page change: the new route fades in over the fast token. Enter only, opacity only, so layout and
 * scroll position never jump. Key it on the top-level route segment so nested pages keep their state.
 */
export function RouteFade({ segment, children }: { segment: string; children: ReactNode }) {
  return (
    <motion.div
      key={segment}
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
    >
      {children}
    </motion.div>
  );
}
