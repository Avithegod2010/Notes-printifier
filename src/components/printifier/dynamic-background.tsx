'use client';

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

/**
 * DynamicBackground — ambient animated backdrop for the whole app.
 *
 * Layers (see globals.css `DYNAMIC BACKGROUND` section):
 *   aurora orbs → drifting grid → light sweep → rising particles →
 *   vignette → film grain.
 *
 * Interaction: a gentle pointer parallax shifts the orb layer and the
 * particle layer in opposite directions (fine-pointer devices only).
 * Accessibility: everything is `aria-hidden`, inert to pointer events,
 * and every CSS animation is disabled under `prefers-reduced-motion`
 * (the parallax listener is also never attached).
 * Performance: JS does zero per-frame work — framer springs settle and
 * all ongoing motion is pure CSS transform/opacity on the compositor.
 */

type Dot = {
  /** horizontal position */
  x: string;
  /** size in px */
  s: number;
  /** duration of one full rise, seconds */
  d: number;
  /** negative delay so dots are mid-flight on first paint */
  delay: number;
  /** horizontal drift over one rise, px */
  drift: number;
  /** peak opacity */
  o: number;
};

/* Hardcoded (not Math.random()) so server & client markup match exactly. */
const DOTS: readonly Dot[] = [
  { x: '4%', s: 2.5, d: 19, delay: -3, drift: 18, o: 0.45 },
  { x: '11%', s: 2, d: 24, delay: -11, drift: -14, o: 0.3 },
  { x: '18%', s: 3, d: 17, delay: -7, drift: 22, o: 0.5 },
  { x: '27%', s: 2, d: 27, delay: -19, drift: -20, o: 0.28 },
  { x: '35%', s: 3.5, d: 21, delay: -1, drift: 16, o: 0.4 },
  { x: '44%', s: 2, d: 30, delay: -23, drift: -12, o: 0.26 },
  { x: '52%', s: 3, d: 18, delay: -9, drift: 24, o: 0.5 },
  { x: '61%', s: 2.5, d: 23, delay: -15, drift: -18, o: 0.34 },
  { x: '69%', s: 2, d: 26, delay: -5, drift: 14, o: 0.3 },
  { x: '77%', s: 3.5, d: 20, delay: -13, drift: -22, o: 0.45 },
  { x: '85%', s: 2, d: 28, delay: -21, drift: 18, o: 0.26 },
  { x: '92%', s: 3, d: 16, delay: -2, drift: -16, o: 0.5 },
  { x: '58%', s: 2, d: 25, delay: -17, drift: 20, o: 0.3 },
  { x: '22%', s: 2.5, d: 22, delay: -25, drift: -24, o: 0.36 },
];

const dotStyle = (p: Dot): CSSProperties =>
  ({
    '--dot-x': p.x,
    '--dot-s': `${p.s}px`,
    '--dot-d': `${p.d}s`,
    '--dot-delay': `${p.delay}s`,
    '--dot-drift': `${p.drift}px`,
    '--dot-o': String(p.o),
  }) as CSSProperties;

export function DynamicBackground() {
  const reduce = useReducedMotion();

  // Normalised pointer position: -1 … 1 on both axes.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);

  // Orbs lean toward the pointer, particles drift away — springy, weighty.
  const orbX = useSpring(useTransform(mx, (v) => v * 22), {
    stiffness: 42,
    damping: 22,
    mass: 0.6,
  });
  const orbY = useSpring(useTransform(my, (v) => v * 16), {
    stiffness: 42,
    damping: 22,
    mass: 0.6,
  });
  const dotX = useSpring(useTransform(mx, (v) => v * -12), {
    stiffness: 30,
    damping: 24,
    mass: 0.8,
  });
  const dotY = useSpring(useTransform(my, (v) => v * -9), {
    stiffness: 30,
    damping: 24,
    mass: 0.8,
  });

  useEffect(() => {
    if (reduce) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      // Ignore touch/pen pointers: on phones pointermove fires during
      // scroll drags and we don't want the backdrop chasing a finger.
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        mx.set((e.clientX / window.innerWidth) * 2 - 1);
        my.set((e.clientY / window.innerHeight) * 2 - 1);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mx, my, reduce]);

  return (
    <div aria-hidden="true" className="dyn-bg" data-testid="dynamic-background">
      {/* aurora orbs (pointer-parallaxed) */}
      <motion.div className="dyn-layer" style={{ x: orbX, y: orbY }}>
        <div className="dyn-orb dyn-orb-1" />
        <div className="dyn-orb dyn-orb-2" />
        <div className="dyn-orb dyn-orb-3" />
        <div className="dyn-orb dyn-orb-4" />
      </motion.div>

      {/* drifting blueprint grid */}
      <div className="dyn-gridlayer" />

      {/* periodic light sweep */}
      <div className="dyn-sweep" />

      {/* rising particles (counter-parallaxed) */}
      <motion.div className="dyn-layer" style={{ x: dotX, y: dotY }}>
        {DOTS.map((p, i) => (
          <span key={i} className="dyn-dot" style={dotStyle(p)} />
        ))}
      </motion.div>

      {/* vignette + film grain */}
      <div className="dyn-vignette" />
      <div className="dyn-noise" />
    </div>
  );
}
