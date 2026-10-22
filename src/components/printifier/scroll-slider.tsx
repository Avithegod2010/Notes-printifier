'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ScrollSlider — a grabbable page scrollbar docked to the right edge of the
 * viewport, below the sticky header. Hold the handle (or anywhere on the rail)
 * and drag to scroll the page — mouse, pen and touch all work via Pointer
 * Events with pointer capture, so the drag keeps tracking even when the finger
 * leaves the rail.
 *
 * Design notes:
 * - Purely imperative thumb positioning (refs + requestAnimationFrame) so
 *   scrolling stays jank-free and never triggers React re-renders per frame.
 * - role="scrollbar" with keyboard support (arrows / PageUp / PageDown /
 *   Home / End); aria-valuenow is kept in sync inside paint().
 * - Fades to a subtle idle state after ~1.4 s without interaction and lights
 *   up on scroll / hover / drag.
 * - Hidden when the page is not scrollable and during printing.
 */

const IDLE_MS = 1400;
const MIN_THUMB = 44;

export function ScrollSlider() {
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const rafRef = useRef(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const [active, setActive] = useState(false);

  const metrics = useCallback(() => {
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !thumb) return null;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 2) return null;
    const railH = rail.clientHeight;
    const thumbH = Math.max(
      MIN_THUMB,
      Math.min(railH, Math.round((railH * window.innerHeight) / doc.scrollHeight)),
    );
    return { max, railH, thumbH };
  }, []);

  const paint = useCallback(() => {
    const m = metrics();
    const thumb = thumbRef.current;
    if (!m || !thumb) return;
    const p = Math.min(1, Math.max(0, window.scrollY / m.max));
    const travel = m.railH - m.thumbH;
    thumb.style.height = `${m.thumbH}px`;
    thumb.style.transform = `translateY(${(p * travel).toFixed(1)}px)`;
    railRef.current?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }, [metrics]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = true;
    requestAnimationFrame(() => {
      rafRef.current = false;
      paint();
    });
  }, [paint]);

  const poke = useCallback(() => {
    setActive(true);
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  /* keep thumb in sync with scrolling, resizes and content height changes */
  useEffect(() => {
    const check = () => {
      const doc = document.documentElement;
      setScrollable(doc.scrollHeight - window.innerHeight > 2);
      schedulePaint();
    };
    // defer the first measure out of the effect body (avoids a cascading render)
    const first = requestAnimationFrame(() => {
      check();
      poke();
    });
    const onScroll = () => {
      poke();
      schedulePaint();
    };
    const onResize = () => check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(check);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      if (idleRef.current) clearTimeout(idleRef.current);
    };
  }, [poke, schedulePaint]);

  /* position the thumb once the rail actually mounts */
  useEffect(() => {
    if (scrollable) schedulePaint();
  }, [scrollable, schedulePaint]);

  const pointerToScroll = useCallback(
    (clientY: number) => {
      const rail = railRef.current;
      const m = metrics();
      if (!rail || !m) return;
      const travel = m.railH - m.thumbH;
      if (travel <= 0) return;
      const rel = clientY - rail.getBoundingClientRect().top - m.thumbH / 2;
      const p = Math.min(1, Math.max(0, rel / travel));
      window.scrollTo({ top: p * m.max });
      schedulePaint();
    },
    [metrics, schedulePaint],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null) return;
    e.preventDefault();
    dragRef.current = e.pointerId;
    railRef.current?.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    pointerToScroll(e.clientY);
    poke();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== e.pointerId) return;
    pointerToScroll(e.clientY);
    poke();
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== e.pointerId) return;
    dragRef.current = null;
    document.body.style.userSelect = '';
    try {
      railRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    poke();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const vh = window.innerHeight;
    const actions: Record<string, () => void> = {
      ArrowDown: () => window.scrollBy({ top: 96 }),
      ArrowUp: () => window.scrollBy({ top: -96 }),
      PageDown: () => window.scrollBy({ top: vh * 0.9 }),
      PageUp: () => window.scrollBy({ top: -vh * 0.9 }),
      Home: () => window.scrollTo({ top: 0 }),
      End: () => window.scrollTo({ top: document.documentElement.scrollHeight }),
    };
    const act = actions[e.key];
    if (!act) return;
    e.preventDefault();
    act();
    schedulePaint();
    poke();
  };

  if (!scrollable) return null;

  return (
    <div
      ref={railRef}
      role="scrollbar"
      aria-label="Scroll page"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-controls="main"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onMouseEnter={poke}
      className={cn(
        'group fixed bottom-0 right-0 top-16 z-40 w-5 cursor-grab touch-none select-none',
        'transition-opacity duration-300 outline-none print:hidden',
        'focus-visible:opacity-100 active:cursor-grabbing',
        active ? 'opacity-100' : 'opacity-45 hover:opacity-100',
      )}
    >
      {/* rail track */}
      <div
        aria-hidden="true"
        className="absolute inset-y-2 right-2 w-1 rounded-full bg-white/10 transition-colors group-hover:bg-white/15 group-active:bg-white/20"
      />
      {/* draggable thumb */}
      <div
        ref={thumbRef}
        aria-hidden="true"
        className="absolute right-[3px] top-0 w-[14px] rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-500/40 transition-[width,background] duration-150 will-change-transform group-hover:from-violet-300 group-hover:to-fuchsia-400 group-active:from-violet-300 group-active:to-fuchsia-400"
        style={{ height: MIN_THUMB }}
      />
    </div>
  );
}
