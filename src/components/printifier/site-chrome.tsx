'use client';

import { useEffect, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Thin gradient progress bar pinned to the very top of the viewport that
 * fills as the page scrolls. Purely decorative (aria-hidden).
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[60] h-[3px] origin-left bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500"
    />
  );
}

/** Floating button that appears after scrolling down; scrolls back to top. */
export function BackToTop() {
  const t = useT();
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 700);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label={t('up.top')}
          initial={reduce ? false : { opacity: 0, y: 16, scale: 0.85 }}
          animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.85 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[var(--header-bg)] text-foreground shadow-xl shadow-black/40 backdrop-blur-md transition-colors hover:border-violet-400/50 hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
