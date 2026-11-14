/**
 * Expanding cards (every `<details>`) open and close in one continuous height animation: 280 ms in,
 * 220 ms out, `--ease-standard`. The CSS-only version (`::details-content` with `interpolate-size`)
 * closed in two steps, height then a late content-visibility switch, which read as a double jerk.
 *
 * One delegated listener on the document handles every card, so call sites need nothing and React
 * keeps owning the DOM: only the element's own `open` attribute and a temporary height change.
 * Clicking mid-way reverses from the current height. Reduced motion toggles at once. A card can
 * opt out with `data-motion="none"`; a click on a control inside the summary is left alone.
 */
const OPEN_MS = 280;
const CLOSE_MS = 220;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

const running = new WeakMap<HTMLDetailsElement, Animation>();

function reducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Height of the card with only its summary showing, measured rather than summed: margins on the
 * summary (a `space-y-*` card), gaps and open-only summary styles all change it. Closing and
 * reopening in the same task lays out twice but never paints the closed state.
 */
function closedHeight(details: HTMLDetailsElement) {
  details.open = false;
  const height = details.getBoundingClientRect().height;
  details.open = true;
  return height;
}

export function toggleDetails(details: HTMLDetailsElement) {
  const closing = details.dataset.closing === 'true';
  const opening = !details.open || closing;
  if (typeof details.animate !== 'function' || reducedMotion()) {
    details.open = opening;
    return;
  }
  const from = details.getBoundingClientRect().height;
  running.get(details)?.cancel();
  details.style.overflow = 'hidden';
  if (opening) {
    details.dataset.closing = 'false';
    details.open = true;
    const to = details.getBoundingClientRect().height;
    const animation = details.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: OPEN_MS,
      easing: EASE,
    });
    running.set(details, animation);
    animation.onfinish = animation.oncancel = () => {
      if (running.get(details) === animation) {
        running.delete(details);
        details.style.overflow = '';
      }
    };
  } else {
    details.dataset.closing = 'true';
    const animation = details.animate(
      [{ height: `${from}px` }, { height: `${closedHeight(details)}px` }],
      { duration: CLOSE_MS, easing: EASE_OUT, fill: 'forwards' },
    );
    running.set(details, animation);
    animation.onfinish = () => {
      if (running.get(details) !== animation) return;
      details.open = false;
      details.dataset.closing = 'false';
      running.delete(details);
      animation.cancel();
      details.style.overflow = '';
    };
  }
}

/** Installs the delegated handler once; returns a cleanup for tests. */
export function installDetailsMotion(root: Document = document) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    const summary = target?.closest('summary');
    const details = summary?.parentElement;
    if (!summary || !(details instanceof HTMLDetailsElement) || details.dataset.motion === 'none') return;
    if (summary !== details.querySelector(':scope > summary')) return;
    // A button, link or field inside the summary does its own thing.
    const control = target?.closest('a, button, input, select, textarea, label');
    if (control && summary.contains(control) && control !== summary) return;
    event.preventDefault();
    toggleDetails(details);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
