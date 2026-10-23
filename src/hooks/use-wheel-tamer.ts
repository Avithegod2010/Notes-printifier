'use client';

/**
 * useWheelTamer — slows down mouse-wheel scrolling on the page.
 *
 * Every wheel tick is damped (default 45% of its native delta) and applied
 * manually, so reaching the footer takes noticeably more wheel turns —
 * useful on long single-page sites like this one where a single flick used
 * to jump half a screen.
 *
 * The damping strength is user-tunable (Theme Workshop → Wheel slider, 0–80%);
 * the store is read per event so moving the slider applies instantly.
 *
 * Preserves the things that must never feel broken:
 *  - Ctrl/Cmd + wheel (pinch-zoom) passes through untouched
 *  - inner scrollables (page grids, selects, dialogs) still scroll, just
 *    damped, and only when they can actually consume the delta
 *  - horizontal trackpad pans (deltaX) pass through untouched
 *  - fractional remainders accumulate so tiny ticks still add up exactly
 */

import { useEffect } from 'react';
import { useThemeStore, WHEEL_DEFAULT } from '@/lib/theme';

/** Nearest ancestor that can scroll vertically right now, if any. */
function scrollableAncestor(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof Element ? node : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const scrollable = /auto|scroll|overlay/.test(style.overflowY);
    if (scrollable && el.scrollHeight > el.clientHeight + 1) {
      return el as HTMLElement;
    }
    el = el.parentElement;
  }
  const root = document.scrollingElement as HTMLElement | null;
  if (root && root.scrollHeight > root.clientHeight + 1) return root;
  return null;
}

/** Normalize a wheel delta into CSS pixels. */
function deltaToPixels(e: WheelEvent): number {
  let delta = e.deltaY;
  if (e.deltaMode === 1) delta *= 16; // lines → px
  else if (e.deltaMode === 2) delta *= window.innerHeight; // pages → px
  return delta;
}

export function useWheelTamer(): void {
  useEffect(() => {
    // Respect the user's escape hatch (?wheel=native) for A/B comparisons.
    try {
      if (new URLSearchParams(window.location.search).has('wheel')) return;
    } catch {
      // URL parsing is best-effort
    }

    // Fractional remainder from the last tick — keeps damped scrolling
    // exact over many small ticks.
    let remainder = 0;

    const onWheel = (e: WheelEvent) => {
      // pinch-zoom / trackpad horizontal pans are never damped
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const target = scrollableAncestor(e.target);
      if (!target) return;

      // Read the user's slider live — 0% means native scroll speed.
      const pct = useThemeStore.getState().wheel;
      const damping =
        typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 ? pct / 100 : WHEEL_DEFAULT / 100;
      if (damping <= 0) return; // 0% → fully native, never touch the event
      if (damping >= 1) return; // 100%+ → native
      const damped = deltaToPixels(e) * damping;
      const move = damped + remainder;
      const whole = Math.sign(move) * Math.max(Math.abs(move) < 0.5 ? 0 : 1, Math.floor(Math.abs(move)));
      remainder = move - whole;
      if (whole === 0) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      const before = target.scrollTop;
      target.scrollTop = before + whole;
      const actual = target.scrollTop - before;
      // hit the end of an inner container → pass the leftovers to the page
      const leftOver = whole - actual;
      if (leftOver !== 0 && target !== document.scrollingElement) {
        const root = document.scrollingElement;
        if (root) root.scrollTop += leftOver;
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}
