import '@testing-library/jest-dom/vitest';
import { MotionGlobalConfig } from 'motion/react';

// jsdom draws no frames: motion jumps to each animation's end state so tests see the result.
MotionGlobalConfig.skipAnimations = true;
