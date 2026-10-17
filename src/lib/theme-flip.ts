/**
 * theme-flip.ts — animated light/dark (or theme) switch.
 *
 * Primary path: the View Transitions API — the browser snapshots the old
 * look, we flip the theme classes, then the new look is revealed with a
 * circular wipe expanding from the button that was clicked.
 *
 * Fallback (old Android WebViews / Firefox / reduced-motion): a translucent
 * accent veil expands from the click point with the Web Animations API
 * while the theme flips underneath. If even WAAPI is missing the flip is
 * instant — always functional, just not fancy.
 */

type DocWithVT = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export function animatedThemeFlip(
  apply: () => void,
  origin?: { x: number; y: number },
): void {
  if (typeof window === 'undefined') {
    apply();
    return;
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 24;

  if (reduce) {
    apply();
    return;
  }

  const doc = document as DocWithVT;
  if (typeof doc.startViewTransition === 'function') {
    try {
      const rs = document.documentElement.style;
      rs.setProperty('--vt-x', `${Math.round(x)}px`);
      rs.setProperty('--vt-y', `${Math.round(y)}px`);
      doc.startViewTransition(apply);
      return;
    } catch {
      // some engines expose the API but reject mid-flight — fall through
    }
  }

  // Fallback: expanding accent veil.
  try {
    const veil = document.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    const s = veil.style;
    s.position = 'fixed';
    s.inset = '0';
    s.zIndex = '9999';
    s.pointerEvents = 'none';
    s.background = 'var(--acc-500, #8b5cf6)';
    s.clipPath = `circle(0px at ${x}px ${y}px)`;
    document.body.appendChild(veil);
    const anim = veil.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 0.25 },
        { clipPath: `circle(150vmax at ${x}px ${y}px)`, opacity: 0 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    );
    anim.onfinish = () => veil.remove();
    anim.oncancel = () => veil.remove();
  } catch {
    // WAAPI unavailable — instant flip
  }

  apply();
}
