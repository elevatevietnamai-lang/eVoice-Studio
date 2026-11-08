import { useEffect, useState } from 'react';

/** Exit length of hand-built popups, matching `menuPopupClass` (150 ms out). */
export const POPUP_EXIT_MS = 150;

/**
 * Keeps a hand-built popup mounted for its exit animation, the way Base UI does for its own
 * popups: `mounted` stays true for `exitMs` after `open` turns false, and `state` drives the
 * `presencePopupClass` keyframes. While closing the popup is `inert` and hidden from assistive
 * tech, so it can be neither clicked nor found as an open menu. Prefer a Base UI primitive; use
 * this only for popups those cannot express (a menu anchored at the text caret).
 */
export function usePresence(open: boolean, exitMs = POPUP_EXIT_MS) {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    // Reduced motion keeps the fade (presencePopupClass drops only the zoom), so the exit still runs.
    const id = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(id);
  }, [open, exitMs]);
  const mounted = open || lingering;
  return {
    mounted,
    props: {
      'data-state': open ? 'open' : 'closed',
      'aria-hidden': open ? undefined : true,
      inert: open ? undefined : true,
    },
  } as const;
}
