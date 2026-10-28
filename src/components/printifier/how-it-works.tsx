'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, FileUp, Printer, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';

/**
 * HowItWorks — the "how to use" showcase.
 *
 * Three step cards, each with its own looping micro-demo (upload → enhance →
 * print). The active step auto-advances every ~2.8 s like a conveyor; hovering
 * or focusing a card pauses the cycle and pins it. All micro-demos are pure
 * framer-motion keyframes; reduced-motion users get static finished states
 * and no auto-advance.
 */

/** Duration of one full micro-demo loop (s). */
const MOCK_LOOP = 5.4;
/** How long each step stays active (ms). */
const STEP_MS = 2800;

/** Fraction of the mock loop at `sec` (helper for keyframe `times`). */
const at = (sec: number) => sec / MOCK_LOOP;

export function HowItWorks() {
  const t = useT();
  const steps = useSteps();
  const reduce = useReducedMotion();
  // Shared conveyor: one active step across all three cards.
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || paused) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % 3), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduce, paused]);

  return (
    <section
      id="how"
      aria-label={steps.title}
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14"
    >
      <SectionHead eyebrow="how.eyebrow" title="how.title" sub="how.sub" />

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.items.map((s, i) => (
          <StepCard
            key={s.n}
            step={s}
            index={i}
            active={active}
            onPin={setPaused}
          />
        ))}
      </div>

      <Reveal delay={0.15}>
        <div className="mt-8 flex flex-col items-center gap-2">
          <Button
            type="button"
            size="lg"
            onClick={() => scrollToId('app')}
            className="neon-edge h-12 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 text-base text-white hover:from-violet-500 hover:to-fuchsia-500"
          >
            {t('how.cta')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <p className="text-xs text-muted-foreground">{t('how.ctaHint')}</p>
        </div>
      </Reveal>
    </section>
  );
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ────────────────────────── data ────────────────────────── */

function useSteps() {
  const t = useT();
  return {
    title: t('how.title'),
    items: [
      { n: '1', icon: FileUp, title: t('how.s1.t'), desc: t('how.s1.d'), mock: <UploadMock /> },
      { n: '2', icon: SlidersHorizontal, title: t('how.s2.t'), desc: t('how.s2.d'), mock: <EnhanceMock /> },
      { n: '3', icon: Printer, title: t('how.s3.t'), desc: t('how.s3.d'), mock: <PrintMock /> },
    ],
  };
}

/* ─────────────────────── step card ─────────────────────── */

function StepCard({
  step,
  index,
  active,
  onPin,
}: {
  step: { n: string; icon: typeof FileUp; title: string; desc: string; mock: React.ReactNode };
  index: number;
  active: number;
  onPin: (pinned: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const isActive = active === index;
  const Icon = step.icon;

  return (
    <Reveal delay={index * 0.1} className="h-full">
      <div
        onMouseEnter={() => onPin(true)}
        onMouseLeave={() => onPin(false)}
        onFocus={() => onPin(true)}
        onBlur={() => onPin(false)}
        tabIndex={-1}
        className={`relative h-full rounded-2xl border p-4 transition-all duration-300 sm:p-5 ${
          isActive
            ? 'border-violet-500/50 bg-violet-500/[0.06] shadow-xl shadow-violet-950/40'
            : 'border-white/10 bg-white/[0.03] hover:border-violet-500/30'
        }`}
      >
        {/* micro-demo stage */}
        <div
          aria-hidden="true"
          className={`pointer-events-none relative mb-4 flex h-32 items-center justify-center overflow-hidden rounded-xl border transition-colors duration-300 sm:h-36 ${
            isActive ? 'border-violet-500/30 bg-violet-500/[0.04]' : 'border-white/10 bg-black/20'
          }`}
        >
          {step.mock}
        </div>

        <div className="flex items-center gap-3">
          <motion.div
            animate={isActive && !reduce ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={{
              duration: 1.2,
              repeat: isActive && !reduce ? Infinity : 0,
              ease: 'easeInOut',
            }}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white shadow-lg ${
              isActive
                ? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-violet-600/30'
                : 'bg-gradient-to-br from-violet-500/70 to-fuchsia-600/70 shadow-violet-600/15'
            }`}
          >
            {step.n}
          </motion.div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className={`h-4 w-4 ${isActive ? 'text-violet-300' : ''}`} aria-hidden="true" />
            <h3 className="text-base font-bold text-foreground sm:text-lg">{step.title}</h3>
          </div>
        </div>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
      </div>
    </Reveal>
  );
}

/* ────────────────────── micro-demos ────────────────────── */

/** Demo 1: a PDF file drops into the tray and page previews pop in. */
function UploadMock() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* tray */}
      <div className="absolute bottom-4 h-10 w-3/5 rounded-lg border border-dashed border-violet-400/40 bg-violet-500/5" />
      {/* file card */}
      <motion.div
        className="absolute left-1/2 top-4 w-20 -translate-x-1/2 rounded-md border border-white/15 bg-zinc-900 p-1.5 shadow-xl sm:w-24"
        animate={reduce ? { y: 46, opacity: 1 } : { y: [0, 46, 46, 46], opacity: [0, 1, 1, 0] }}
        transition={
          reduce
            ? { duration: 0.4 }
            : {
                duration: MOCK_LOOP,
                times: [0, at(1.2), at(4.6), at(5.2)],
                repeat: Infinity,
                ease: 'easeOut',
              }
        }
      >
        <div className="mx-auto mb-1 h-4 w-4 rounded-sm bg-violet-500/70" />
        <div className="h-1 w-3/4 rounded bg-white/30" />
        <div className="mt-0.5 h-1 w-1/2 rounded bg-white/20" />
      </motion.div>
      {/* page previews popping in the tray */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute bottom-6 h-7 w-5 rounded-[2px] border border-white/25 bg-white/90 shadow sm:h-8 sm:w-6"
          style={{ left: `${38 + i * 9}%` }}
          animate={reduce ? { opacity: 1, scale: 1 } : { opacity: [0, 0, 1, 1, 0], scale: [0.5, 0.5, 1, 1, 0.8] }}
          transition={
            reduce
              ? { duration: 0.3, delay: 0.4 + i * 0.1 }
              : {
                  duration: MOCK_LOOP,
                  times: [0, at(1.5 + i * 0.45), at(1.75 + i * 0.45), at(4.6), at(5.1)],
                  repeat: Infinity,
                  ease: 'easeOut',
                }
          }
        >
          <div className="mx-auto mt-1 h-0.5 w-2/3 rounded bg-zinc-400" />
          <div className="mx-auto mt-0.5 h-0.5 w-1/2 rounded bg-zinc-300" />
        </motion.div>
      ))}
    </div>
  );
}

/** Demo 2: a dark slide sweeps to bright while the slider knob travels. */
function EnhanceMock() {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full w-full items-center justify-center gap-3 px-4">
      {/* the page flipping dark → bright */}
      <motion.div
        className="h-16 w-14 overflow-hidden rounded-md border border-white/20 shadow-lg sm:h-20 sm:w-16"
        animate={
          reduce
            ? { backgroundColor: '#fafafa' }
            : {
                backgroundColor: ['#1c1917', '#1c1917', '#fafafa', '#fafafa', '#1c1917'],
              }
        }
        transition={
          reduce
            ? { duration: 0.3 }
            : {
                duration: MOCK_LOOP,
                times: [0, at(0.9), at(2.1), at(4.7), at(5.3)],
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      >
        <motion.div
          className="p-1.5"
          animate={reduce ? { opacity: 1 } : { opacity: [0.6, 0.6, 1, 1, 0.6] }}
          transition={
            reduce
              ? { duration: 0.3 }
              : { duration: MOCK_LOOP, times: [0, at(0.9), at(2.1), at(4.7), at(5.3)], repeat: Infinity }
          }
        >
          <div className="h-1 w-3/4 rounded bg-amber-400/70" />
          <div className="mt-1 h-0.5 w-1/2 rounded bg-zinc-400" />
          <div className="mt-1.5 h-3 w-2/3 rounded-sm bg-zinc-300/40" />
          <div className="mt-1 h-0.5 w-3/5 rounded bg-zinc-400" />
        </motion.div>
      </motion.div>

      {/* the slider */}
      <div className="flex flex-col items-center gap-1.5">
        <SlidersHorizontal className="h-4 w-4 text-violet-300" />
        <div className="relative h-1.5 w-14 rounded-full bg-white/15 sm:w-16">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
            animate={reduce ? { width: '72%' } : { width: ['12%', '12%', '72%', '72%', '12%'] }}
            transition={
              reduce
                ? { duration: 0.3 }
                : { duration: MOCK_LOOP, times: [0, at(0.9), at(2.1), at(4.7), at(5.3)], repeat: Infinity, ease: 'easeInOut' }
            }
          />
          <motion.div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-violet-300 bg-white shadow"
            animate={reduce ? { left: '68%' } : { left: ['8%', '8%', '68%', '68%', '8%'] }}
            transition={
              reduce
                ? { duration: 0.3 }
                : { duration: MOCK_LOOP, times: [0, at(0.9), at(2.1), at(4.7), at(5.3)], repeat: Infinity, ease: 'easeInOut' }
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Demo 3: the printer emits bright numbered pages that stack up. */
function PrintMock() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* printer body */}
      <div className="absolute left-1/2 top-5 w-24 -translate-x-1/2 sm:w-28">
        <div className="flex h-9 items-center justify-between rounded-lg border border-white/15 bg-zinc-800/90 px-2.5 shadow-xl">
          <Printer className="h-4 w-4 text-violet-300" />
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            animate={reduce ? { opacity: 1 } : { opacity: [1, 0.25, 1] }}
            transition={reduce ? { duration: 0.3 } : { duration: 1.4, repeat: Infinity }}
          />
        </div>
        <div className="mx-auto h-1.5 w-3/4 rounded-b-md border-x border-b border-white/10 bg-zinc-900" />
      </div>
      {/* pages sliding out and stacking */}
      {[2, 1, 0].map((k) => {
        const i = 2 - k; // emission order
        return (
          <motion.div
            key={k}
            className="absolute top-[4.4rem] flex h-9 w-12 items-start justify-center rounded-[2px] border border-zinc-300 bg-white pt-1 shadow-lg sm:top-[5.4rem] sm:h-11 sm:w-14"
            style={{ zIndex: k }}
            animate={
              reduce
                ? { y: k * 5, opacity: 1, scale: 1 }
                : {
                    y: [-34, k * 5, k * 5, k * 5],
                    opacity: [0, 1, 1, 0],
                    scale: [0.85, 1, 1, 0.9],
                  }
            }
            transition={
              reduce
                ? { duration: 0.3, delay: i * 0.1 }
                : {
                    duration: MOCK_LOOP,
                    times: [at(0.5 + i * 0.7), at(1.2 + i * 0.7), at(4.8), at(5.3)],
                    repeat: Infinity,
                    ease: 'easeOut',
                  }
            }
          >
            <span className="text-[7px] font-bold leading-none text-zinc-500">{i + 1}</span>
          </motion.div>
        );
      })}
      {/* saved chip */}
      <motion.div
        className="absolute bottom-3 right-3 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300"
        animate={reduce ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0], y: [6, 6, 0, 0, 6] }}
        transition={
          reduce
            ? { duration: 0.3 }
            : { duration: MOCK_LOOP, times: [0, at(3), at(3.4), at(4.8), at(5.3)], repeat: Infinity }
        }
      >
        −80% ink
      </motion.div>
    </div>
  );
}
