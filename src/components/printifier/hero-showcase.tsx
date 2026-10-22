'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Droplets, Grid2x2, Leaf, Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * HeroShowcase — an auto-replaying, choreographed "before → after" demo.
 *
 * A 7-second loop:
 *   1. Three dark lecture slides sit in the "before" stack.
 *   2. One by one they are "consumed": each lifts, a spark travels across
 *      the arrow, and a bright cell pops into the N-up sheet.
 *   3. When all three landed, the sheet pulses with a glow + sparkle burst.
 *   4. A short hold, then everything resets and the loop replays.
 *
 * Everything is pure framer-motion keyframes (no timers / no state) so the
 * loop is perfectly synchronised and cheap. Reduced-motion users get the
 * finished "after" state with no animation.
 */

/** Total loop duration (s). All keyframe `times` are fractions of this. */
const LOOP = 7;

/** Slide i starts its flight at this time (s). */
const FLIGHT = [0.7, 1.25, 1.8];
/** Its bright cell lands at flight + 0.55 (s). */
const LAND = FLIGHT.map((d) => d + 0.55);
/** Glow + sparkle moment (s) — after the last cell lands. */
const SHINE = 3.1;
/** Reset moment (s) — everything fades back for the next pass. */
const RESET = 6.2;

const s = (t: number) => t / LOOP;

export function HeroShowcase() {
  const t = useT();
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.35 }}
      className="relative mx-auto mt-12 w-full max-w-3xl sm:mt-16"
    >
      {/* floating stat chips (desktop) */}
      <FloatingChip reduce={reduce} delay={1.0} className="absolute -left-4 top-16 z-20 hidden lg:flex">
        <Droplets className="h-3.5 w-3.5 text-emerald-400" /> {t('hero.chip.ink')}
      </FloatingChip>
      <FloatingChip reduce={reduce} delay={1.25} className="absolute -top-5 right-2 z-20 hidden lg:flex">
        <Grid2x2 className="h-3.5 w-3.5 text-violet-300" /> {t('hero.chip.grid')}
      </FloatingChip>
      <FloatingChip reduce={reduce} delay={1.5} className="absolute -bottom-4 right-8 z-20 hidden lg:flex">
        <Leaf className="h-3.5 w-3.5 text-emerald-400" /> {t('hero.chip.sheets')}
      </FloatingChip>

      <div className="holo-ring relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-6">
        {/* header row */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t('show.stage')}
          </span>
          {/* live badge + loop progress hairline */}
          <span className="flex items-center gap-2">
            {!reduce && (
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <motion.span
                  className="absolute inline-flex h-full w-full rounded-full bg-emerald-400"
                  animate={{ opacity: [0.9, 0.25, 0.9], scale: [1, 1.35, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
            )}
            <span className="text-[11px] font-medium text-emerald-300/90">{t('show.auto')}</span>
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
          {/* ── BEFORE: stack of dark slides ── */}
          <div className="flex flex-col items-center">
            <div className="relative h-28 w-full max-w-[180px] sm:h-36">
              {/* back cards of the fan */}
              <div className="absolute inset-x-3 top-2 h-full rotate-[5deg] rounded-lg border border-white/10 bg-zinc-900/80 shadow-lg" />
              <div className="absolute inset-x-1.5 top-1 h-full -rotate-[3deg] rounded-lg border border-white/10 bg-zinc-900/90 shadow-lg" />
              {/* the three active slides — each gets "consumed" in turn */}
              {FLIGHT.map((d, i) => (
                <motion.div
                  key={i}
                  className="absolute inset-x-0 top-0 h-full overflow-hidden rounded-lg border border-white/15 shadow-xl"
                  style={{ zIndex: 10 - i }}
                  animate={
                    reduce
                      ? { opacity: 1 }
                      : {
                          opacity: [1, 1, 1, 0.28, 0.28, 1, 1],
                          y: [0, 0, -7, -7, 0, 0, 0],
                          rotate: [0, 0, -2, 0, 0, 0, 0],
                        }
                  }
                  transition={
                    reduce
                      ? { duration: 0.3 }
                      : {
                          duration: LOOP,
                          times: [
                            0,
                            s(FLIGHT[i] - 0.15),
                            s(FLIGHT[i] + 0.05),
                            s(FLIGHT[i] + 0.35),
                            s(FLIGHT[i] + 0.9),
                            s(RESET),
                            1,
                          ],
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                  }
                >
                  <div className="h-full w-full bg-gradient-to-br from-[#2b1d16] to-[#120b08] p-2 sm:p-2.5">
                    <div className="h-1.5 w-3/4 rounded bg-amber-500/70 sm:h-2" />
                    <div className="mt-1.5 h-1 w-1/2 rounded bg-white/25" />
                    <div className="mt-2 h-1 w-2/3 rounded bg-fuchsia-400/60" />
                    <div className="mt-1 h-1 w-1/2 rounded bg-emerald-400/50" />
                    <div className="mt-2 h-4 w-3/4 rounded bg-white/10 sm:h-6" />
                    <div className="mt-1.5 h-1 w-2/5 rounded bg-white/20" />
                  </div>
                </motion.div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">{t('hero.before')}</p>
          </div>

          {/* ── MIDDLE: arrow + travelling sparks ── */}
          <div className="relative flex flex-col items-center gap-1.5" aria-hidden="true">
            <motion.div
              animate={reduce ? undefined : { scale: [1, 1.18, 1] }}
              transition={{
                duration: LOOP,
                times: [0, s(SHINE), 1],
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <Sparkles className="h-5 w-5 text-violet-400" />
            </motion.div>
            <div className="relative h-5 w-14 sm:w-20">
              {/* track */}
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-white/10 via-white/25 to-white/10" />
              {/* three sparks that ride the track as each slide converts */}
              {!reduce &&
                LAND.map((d, i) => (
                  <motion.span
                    key={i}
                    className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-violet-300 shadow-[0_0_8px_2px_rgba(167,139,250,0.8)]"
                    animate={{
                      left: ['0%', '100%'],
                      opacity: [0, 1, 1, 0],
                    }}
                    transition={{
                      duration: LOOP,
                      times: [s(d - 0.3), s(d), s(d + 0.25), s(d + 0.45)],
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
            </div>
          </div>

          {/* ── AFTER: bright N-up sheet filling up ── */}
          <div className="flex flex-col items-center">
            <div className="relative h-28 w-full max-w-[150px] sm:h-36">
              {/* sheet glow burst */}
              {!reduce && (
                <motion.div
                  aria-hidden="true"
                  className="absolute -inset-2 rounded-2xl bg-violet-500/25 blur-xl"
                  animate={{ opacity: [0, 0, 0.9, 0, 0] }}
                  transition={{
                    duration: LOOP,
                    times: [0, s(SHINE - 0.15), s(SHINE + 0.15), s(SHINE + 0.9), 1],
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              )}
              <div className="relative mx-auto flex h-full w-[82%] flex-col gap-1 overflow-hidden rounded-lg border border-white/15 bg-zinc-200/90 p-1.5 shadow-2xl shadow-violet-900/40">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="min-h-0 flex-1 rounded-[3px] bg-zinc-100 p-1.5"
                    animate={
                      reduce
                        ? { opacity: 1, scale: 1 }
                        : {
                            opacity: [0, 0, 1, 1, 0],
                            scale: [0.6, 0.6, 1, 1, 0.9],
                          }
                    }
                    transition={
                      reduce
                        ? { duration: 0.3, delay: i * 0.08 }
                        : {
                            duration: LOOP,
                            times: [0, s(LAND[i] - 0.02), s(LAND[i] + 0.3), s(RESET), 1],
                            repeat: Infinity,
                            ease: 'easeOut',
                          }
                    }
                  >
                    <div className="h-1 w-2/3 rounded bg-zinc-500" />
                    <div className="mt-0.5 h-0.5 w-1/2 rounded bg-zinc-400" />
                    <div className="mt-1 h-1.5 w-3/4 rounded-sm bg-zinc-300" />
                  </motion.div>
                ))}
                {/* page number */}
                <motion.span
                  className="text-center text-[6px] leading-none text-zinc-400"
                  animate={reduce ? { opacity: 1 } : { opacity: [0, 0, 1, 1, 0] }}
                  transition={
                    reduce
                      ? { duration: 0.3 }
                      : {
                          duration: LOOP,
                          times: [0, s(LAND[2]), s(LAND[2] + 0.2), s(RESET), 1],
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }
                  }
                  aria-hidden="true"
                >
                  1
                </motion.span>
                {/* sparkle burst when the sheet completes */}
                {!reduce && (
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    animate={{ opacity: [0, 0, 1, 0, 0], scale: [0.4, 0.4, 1.25, 1.5, 0.4] }}
                    transition={{
                      duration: LOOP,
                      times: [0, s(SHINE - 0.1), s(SHINE + 0.2), s(SHINE + 0.7), 1],
                      repeat: Infinity,
                      ease: 'easeOut',
                    }}
                  >
                    <Sparkles className="h-6 w-6 text-violet-500" />
                  </motion.div>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-xs font-medium text-emerald-300">{t('hero.after')}</p>
          </div>
        </div>

        {/* loop progress hairline (decorative) */}
        {!reduce && (
          <div className="mt-4 h-0.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
            <motion.div
              className="h-full origin-left bg-gradient-to-r from-violet-500/60 via-fuchsia-500/60 to-violet-500/60"
              animate={{ scaleX: [0, 1] }}
              transition={{ duration: LOOP, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Gentle bobbing glass chip (moved here from printifier-app). */
export function FloatingChip({
  children,
  className,
  delay,
  reduce,
}: {
  children: React.ReactNode;
  className?: string;
  delay: number;
  reduce: boolean | null;
}) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.8 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: 'easeOut' }}
      className={className}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -7, 0] }}
        transition={{ duration: 3.5 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold shadow-xl backdrop-blur-md"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
