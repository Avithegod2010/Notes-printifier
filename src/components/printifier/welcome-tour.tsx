'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  Droplets,
  FileUp,
  Layers,
  Lock,
  Palette,
  Play,
  Printer,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { THEMES, PATTERNS, useThemeStore, type PatternId, type ThemeId } from '@/lib/theme';
import { usePrintifyStore } from '@/lib/printify-store';
import { ThemeSwatch } from './theme-swatch';
import { ExampleDialog } from './example-dialog';

const LS_SEEN = 'printifier.tour';
const STEP_COUNT = 4;
/** Bundled demo: 41 dark slides, default recipe = 3-up → 14 bright pages. */
const DEMO_BEFORE = 41;
const DEMO_AFTER = Math.ceil(DEMO_BEFORE / 3);
const DEMO_PAGES_SAVED = Math.round((1 - DEMO_AFTER / DEMO_BEFORE) * 100);

const THEME_NAME_KEY: Record<ThemeId, string> = {
  violet: 'th.violet',
  paper: 'th.paper',
  cyber: 'th.cyber',
  matrix: 'th.matrix',
  ember: 'th.ember',
  rose: 'th.rose',
  crimson: 'th.crimson',
  ocean: 'th.ocean',
  nord: 'th.nord',
  noir: 'th.noir',
  sand: 'th.sand',
  mint: 'th.mint',
  blueprint: 'th.blueprint',
  kraft: 'th.kraft',
  chai: 'th.chai',
  festive: 'th.festive',
  xerox: 'th.xerox',
  ohp: 'th.ohp',
};

/**
 * WelcomeTour — first-visit guided intro: what Printifier is → make it yours
 * (live theme swatches) → a real before/after example → try it yourself.
 * Auto-opens once per device (localStorage), replayable via the ⌘K palette
 * or the `printifier:tour` window event.
 *
 * Animation: the card springs in, each step's content staggers up item by
 * item, the icon pops and then gently floats, and the step-2 example's
 * bright cells pop in. Everything collapses to simple fades (or nothing)
 * when the user prefers reduced motion.
 */
export function WelcomeTour() {
  const t = useT();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [exampleOpen, setExampleOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const pattern = useThemeStore((s) => s.pattern);
  const setPattern = useThemeStore((s) => s.setPattern);
  /** Theme currently hover/keyboard-previewed in step 2 (live preview). */
  const [hoverId, setHoverId] = useState<ThemeId | null>(null);
  const swatchWrapRef = useRef<HTMLDivElement>(null);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(LS_SEEN, '2');
    } catch {
      // private mode — tour will simply re-offer next visit
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    useThemeStore.getState().preview(null); // drop any in-flight live preview
    markSeen();
  }, [markSeen]);

  // Auto-open once per device (only while nothing is loaded), and allow
  // replay from the command palette / window event.
  useEffect(() => {
    let seen = '2';
    try {
      seen = localStorage.getItem(LS_SEEN) ?? '';
    } catch {
      // ignore
    }
    const timer = window.setTimeout(() => {
      // never cover a document the user already arrived with
      if (seen !== '2' && usePrintifyStore.getState().step === 0) setOpen(true);
    }, 900);
    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('printifier:tour', reopen);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('printifier:tour', reopen);
    };
  }, []);

  // Leaving step 2 (Back/Next/dots) must restore the committed theme.
  useEffect(() => {
    if (step !== 1) useThemeStore.getState().preview(null);
  }, [step]);

  // Escape closes + scroll lock while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cardRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  const goTo = (i: number) => setStep(Math.min(STEP_COUNT - 1, Math.max(0, i)));

  /* ── step-2 live theme preview ── */
  const previewOn = useCallback((id: ThemeId) => {
    setHoverId(id);
    useThemeStore.getState().preview(id);
  }, []);
  const previewOff = useCallback(() => {
    setHoverId(null);
    useThemeStore.getState().preview(null);
  }, []);

  /** Roving arrow keys across both swatch groups (dark 0-7 → light 8-11). */
  const onSwatchKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(
      swatchWrapRef.current?.querySelectorAll<HTMLButtonElement>('[data-swatch]') ?? [],
    );
    const cur = els.indexOf(document.activeElement as HTMLButtonElement);
    if (cur < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = Math.min(els.length - 1, cur + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowDown') next = Math.min(els.length - 1, cur + 6);
    else if (e.key === 'ArrowUp') next = Math.max(0, cur - 6);
    if (next < 0) return;
    e.preventDefault();
    els[next]?.focus();
  };

  const shownId = hoverId ?? themeId;
  const shownMeta = THEMES.find((x) => x.id === shownId) ?? THEMES[0];

  const renderSwatch = (th: (typeof THEMES)[number]) => (
    <motion.button
      key={th.id}
      variants={popV}
      type="button"
      data-swatch=""
      title={t(THEME_NAME_KEY[th.id])}
      aria-label={t(THEME_NAME_KEY[th.id])}
      aria-pressed={themeId === th.id}
      onClick={() => setTheme(th.id)}
      onMouseEnter={() => previewOn(th.id)}
      onFocus={() => previewOn(th.id)}
      className={cn(
        'relative mx-auto h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        themeId === th.id
          ? 'border-white/70 shadow-lg'
          : hoverId === th.id
            ? 'border-white/50 shadow-md'
            : 'border-white/20',
      )}
    >
      {/* clean two-tone disc: page background + accent dot (no diagonal split) */}
      <ThemeSwatch th={th} className="h-full w-full" showDot={themeId !== th.id} />
      {themeId === th.id && (
        <Check
          className={cn(
            'absolute inset-0 m-auto h-4 w-4 drop-shadow-md',
            th.light ? 'text-zinc-900' : 'text-white',
          )}
        />
      )}
    </motion.button>
  );

  /** Final CTA — drop the user right onto the upload zone with a spotlight. */
  const tryYourself = () => {
    close();
    // The dropzone only exists on the upload step; mid-pipeline replays land
    // on the app card instead.
    const dz = document.querySelector<HTMLElement>('[data-dropzone]');
    const target = dz ?? document.getElementById('app');
    target?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: dz ? 'center' : 'start',
    });
    if (!reduced && dz) {
      dz.classList.add('dropzone-pulse');
      window.setTimeout(() => dz.classList.remove('dropzone-pulse'), 2600);
    }
  };

  const loadSampleAndClose = () => {
    close();
    window.dispatchEvent(new CustomEvent('printifier:load-sample'));
  };

  const browseFullExample = () => {
    close();
    setExampleOpen(true);
  };

  /* ── shared animation variants (motion-safe vs reduced) ── */
  const overlayV: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.25 } },
        exit: { opacity: 0, transition: { duration: 0.2 } },
      };
  const cardV: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, scale: 0.88, y: 26 },
        show: {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { type: 'spring', stiffness: 280, damping: 24 },
        },
        exit: { opacity: 0, scale: 0.94, y: 10, transition: { duration: 0.18 } },
      };
  /** Each step: children stagger up. */
  const stepV: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        hidden: {},
        show: { transition: { staggerChildren: 0.075, delayChildren: 0.04 } },
      };
  const itemV: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: 'easeOut' } },
      };
  /** Nested stagger groups (badges, swatches, list rows). */
  const groupV: Variants = reduced
    ? { hidden: {}, show: {} }
    : { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
  const popV: Variants = reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        hidden: { opacity: 0, scale: 0.6 },
        show: {
          opacity: 1,
          scale: 1,
          transition: { type: 'spring', stiffness: 380, damping: 20 },
        },
      };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="tour-overlay"
            variants={overlayV}
            initial="hidden"
            animate="show"
            exit="exit"
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4 pt-safe-4 pb-safe-4 backdrop-blur-sm"
            onClick={close}
            role="presentation"
          >
            <motion.div
              ref={cardRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={t('tour.aria')}
              variants={cardV}
              onClick={(e) => e.stopPropagation()}
              className="holo-ring relative w-full max-w-md rounded-3xl border border-white/12 bg-popover/95 p-6 shadow-2xl shadow-black/60 outline-none"
            >
              <button
                type="button"
                onClick={close}
                className="absolute right-4 top-4 inline-flex h-12 min-w-28 items-center justify-center rounded-full border border-white/25 bg-white/10 px-6 text-base font-bold text-foreground shadow-sm transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('tour.skip')}
              </button>

              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {t('tour.stepN', { n: step + 1, m: STEP_COUNT })}
              </p>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  variants={stepV}
                  initial="hidden"
                  animate="show"
                  exit={
                    reduced
                      ? { opacity: 0, transition: { duration: 0.12 } }
                      : { opacity: 0, x: -26, transition: { duration: 0.18, ease: 'easeIn' } }
                  }
                >
                  {step === 0 && (
                    <div>
                      <TourIcon icon={Printer} variants={popV} reduce={reduced} />
                      <motion.h2
                        variants={itemV}
                        className="text-xl font-extrabold tracking-tight"
                      >
                        {t('tour.s1.t')}
                      </motion.h2>
                      <motion.p
                        variants={itemV}
                        className="mt-2 text-sm leading-relaxed text-muted-foreground"
                      >
                        {t('tour.s1.b')}
                      </motion.p>
                      <motion.div
                        variants={groupV}
                        className="mt-4 flex flex-wrap gap-1.5"
                      >
                        {(
                          [
                            { icon: Layers, k: 'tour.s1.c1' },
                            { icon: Droplets, k: 'tour.s1.c2' },
                            { icon: BookOpenCheck, k: 'tour.s1.c3' },
                            { icon: Lock, k: 'tour.s1.c4' },
                          ] as const
                        ).map(({ icon: Icon, k }) => (
                          <motion.div key={k} variants={popV}>
                            <Badge
                              variant="outline"
                              className="border-white/15 bg-white/5 font-normal"
                            >
                              <Icon className="mr-1 h-3 w-3 text-primary" />
                              {t(k)}
                            </Badge>
                          </motion.div>
                        ))}
                      </motion.div>
                    </div>
                  )}

                  {step === 1 && (
                    <div>
                      <TourIcon icon={Palette} variants={popV} reduce={reduced} />
                      <motion.h2
                        variants={itemV}
                        className="text-xl font-extrabold tracking-tight"
                      >
                        {t('tour.s2.t')}
                      </motion.h2>
                      <motion.p
                        variants={itemV}
                        className="mt-2 text-sm leading-relaxed text-muted-foreground"
                      >
                        {t('tour.s2.b')}
                      </motion.p>

                      {/* live preview pane — mirrors the hovered/selected theme */}
                      <motion.div variants={itemV} className="mt-4">
                        <div
                          aria-hidden="true"
                          className="overflow-hidden rounded-xl border transition-colors duration-300"
                          style={{
                            background: shownMeta.swatch[0],
                            borderColor: shownMeta.light
                              ? 'rgba(0,0,0,0.10)'
                              : 'rgba(255,255,255,0.10)',
                          }}
                        >
                          <div
                            className="flex items-center justify-between border-b px-3 py-2 transition-colors duration-300"
                            style={{
                              borderColor: shownMeta.light
                                ? 'rgba(0,0,0,0.07)'
                                : 'rgba(255,255,255,0.07)',
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              {[0.6, 0.45, 0.3].map((a) => (
                                <span
                                  key={a}
                                  className="h-2 w-2 rounded-full transition-colors duration-300"
                                  style={{ background: shownMeta.swatch[2], opacity: a }}
                                />
                              ))}
                            </span>
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                              style={{
                                color: shownMeta.swatch[2],
                                border: `1px solid ${shownMeta.swatch[2]}55`,
                              }}
                            >
                              {t('tour.s2.live')}
                            </span>
                          </div>
                          <div className="p-3">
                            <div
                              className="h-2 w-1/2 rounded-full transition-colors duration-300"
                              style={{ background: shownMeta.swatch[2] }}
                            />
                            <div
                              className="mt-1.5 h-1.5 w-3/4 rounded-full transition-colors duration-300"
                              style={{
                                background: shownMeta.light
                                  ? 'rgba(0,0,0,0.28)'
                                  : 'rgba(255,255,255,0.30)',
                              }}
                            />
                            <div
                              className="mt-1 h-1.5 w-2/3 rounded-full transition-colors duration-300"
                              style={{
                                background: shownMeta.light
                                  ? 'rgba(0,0,0,0.16)'
                                  : 'rgba(255,255,255,0.15)',
                              }}
                            />
                            <div className="mt-2.5 flex items-center gap-2">
                              <span
                                className="flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-white shadow-sm transition-colors duration-300"
                                style={{ background: shownMeta.swatch[2] }}
                              >
                                <Printer className="h-3 w-3" />
                                PDF
                              </span>
                              <span
                                className="text-[10px] font-bold transition-colors duration-300"
                                style={{ color: shownMeta.swatch[2] }}
                              >
                                −80% ink
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between px-0.5">
                          <span className="text-xs font-semibold">
                            {t(THEME_NAME_KEY[shownMeta.id])}
                          </span>
                          <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t(shownMeta.light ? 'tour.s2.light' : 'tour.s2.dark')}
                          </span>
                        </div>
                      </motion.div>

                      {/* swatches — grouped dark/light, hover = live preview,
                          click = keep. Arrow keys rove across all 12. */}
                      <div
                        ref={swatchWrapRef}
                        onKeyDown={onSwatchKey}
                        onMouseLeave={previewOff}
                        onBlurCapture={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                            previewOff();
                        }}
                      >
                        <motion.p
                          variants={itemV}
                          className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {t('tour.s2.dark')}
                        </motion.p>
                        <motion.div
                          variants={groupV}
                          className="mt-1.5 grid grid-cols-6 gap-2"
                          role="group"
                          aria-label={t('tour.s2.dark')}
                        >
                          {THEMES.filter((th) => !th.light).map(renderSwatch)}
                        </motion.div>
                        <motion.p
                          variants={itemV}
                          className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {t('tour.s2.light')}
                        </motion.p>
                        <motion.div
                          variants={groupV}
                          className="mt-1.5 grid grid-cols-6 gap-2"
                          role="group"
                          aria-label={t('tour.s2.light')}
                        >
                          {THEMES.filter((th) => th.light).map(renderSwatch)}
                        </motion.div>
                        {/* backdrop pattern — completes the color picker:
                            theme + pattern = the full look */}
                        <motion.p
                          variants={itemV}
                          className="mt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {t('tour.s2.patterns')}
                        </motion.p>
                        <motion.div
                          variants={groupV}
                          className="mt-1.5 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label={t('tour.s2.patterns')}
                        >
                          {PATTERNS.map((p: PatternId) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setPattern(p)}
                              aria-pressed={pattern === p}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors',
                                pattern === p
                                  ? 'border-primary bg-primary/15 text-primary'
                                  : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/25 hover:text-foreground',
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </motion.div>
                      </div>
                      <motion.p
                        variants={itemV}
                        className="mt-3 text-center text-xs text-muted-foreground"
                      >
                        {t('tour.s2.hint')}
                      </motion.p>
                    </div>
                  )}

                  {step === 2 && (
                    <div>
                      <TourIcon icon={Play} variants={popV} reduce={reduced} />
                      <motion.h2
                        variants={itemV}
                        className="text-xl font-extrabold tracking-tight"
                      >
                        {t('tour.s3.t')}
                      </motion.h2>
                      <motion.p
                        variants={itemV}
                        className="mt-2 text-sm leading-relaxed text-muted-foreground"
                      >
                        {t('tour.s3.b')}
                      </motion.p>

                      {/* mini before/after mock of the bundled sample */}
                      <motion.div variants={groupV} className="mt-4 grid grid-cols-2 gap-3">
                        <motion.div
                          variants={itemV}
                          className="rounded-xl border border-white/10 p-2"
                        >
                          <div className="aspect-[4/3] w-full rounded-md bg-zinc-900 p-2.5">
                            <div className="h-1.5 w-1/2 rounded bg-white/30" />
                            <div className="mt-2 h-1 w-3/4 rounded bg-white/15" />
                            <div className="mt-1 h-1 w-2/3 rounded bg-white/10" />
                            <div className="mt-1 h-1 w-1/2 rounded bg-white/10" />
                            <div className="mt-2.5 flex items-center gap-1.5">
                              <div className="h-4 w-4 rounded-full border border-white/20" />
                              <div className="h-1 w-8 rounded bg-white/10" />
                            </div>
                          </div>
                          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                            {t('tour.s3.before', { n: DEMO_BEFORE })}
                          </p>
                        </motion.div>
                        <motion.div
                          variants={itemV}
                          className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.05] p-2"
                        >
                          <div className="aspect-[4/3] w-full rounded-md bg-white p-2">
                            <motion.div variants={groupV} className="grid grid-cols-3 gap-1">
                              {[0, 1, 2].map((i) => (
                                <motion.div
                                  key={i}
                                  variants={popV}
                                  className="aspect-[4/3] rounded-[3px] bg-zinc-800 p-1"
                                >
                                  <div className="h-0.5 w-3/4 rounded bg-white/40" />
                                  <div className="mt-0.5 h-0.5 w-1/2 rounded bg-white/20" />
                                </motion.div>
                              ))}
                            </motion.div>
                            <div className="mt-1.5 h-0.5 w-3/4 rounded bg-zinc-300" />
                            <div className="mt-1 h-0.5 w-1/2 rounded bg-zinc-200" />
                          </div>
                          <p className="mt-1.5 text-center text-[10px] text-emerald-300">
                            {t('tour.s3.after', { n: DEMO_AFTER })}
                          </p>
                        </motion.div>
                      </motion.div>
                      <motion.div
                        variants={groupV}
                        className="mt-3 flex flex-wrap justify-center gap-1.5"
                      >
                        <motion.div variants={popV}>
                          <Badge
                            variant="outline"
                            className="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                          >
                            <Check className="mr-1 h-3 w-3" />
                            {t('tour.s3.pages', { n: DEMO_PAGES_SAVED })}
                          </Badge>
                        </motion.div>
                        <motion.div variants={popV}>
                          <Badge
                            variant="outline"
                            className="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                          >
                            <Check className="mr-1 h-3 w-3" />
                            {t('tour.s3.ink')}
                          </Badge>
                        </motion.div>
                      </motion.div>

                      <motion.div variants={itemV} className="mt-4 flex flex-col gap-2">
                        <Button
                          type="button"
                          onClick={loadSampleAndClose}
                          className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
                        >
                          <Sparkles className="mr-2 h-4 w-4" />
                          {t('tour.s3.load')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={browseFullExample}
                          className="text-muted-foreground"
                        >
                          {t('tour.s3.full')}
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </motion.div>
                    </div>
                  )}

                  {step === 3 && (
                    <div>
                      <TourIcon icon={SlidersHorizontal} variants={popV} reduce={reduced} />
                      <motion.h2
                        variants={itemV}
                        className="text-xl font-extrabold tracking-tight"
                      >
                        {t('tour.s4.t')}
                      </motion.h2>
                      <motion.p
                        variants={itemV}
                        className="mt-2 text-sm leading-relaxed text-muted-foreground"
                      >
                        {t('tour.s4.b')}
                      </motion.p>
                      <motion.ol variants={groupV} className="mt-4 space-y-2">
                        {(
                          [
                            { icon: FileUp, k: 'tour.s4.s1' },
                            { icon: SlidersHorizontal, k: 'tour.s4.s2' },
                            { icon: Printer, k: 'tour.s4.s3' },
                          ] as const
                        ).map(({ icon: Icon, k }, i) => (
                          <motion.li
                            key={k}
                            variants={itemV}
                            className="flex items-center gap-2.5 text-sm"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span>
                              <span className="mr-1.5 font-semibold text-primary">
                                {i + 1}.
                              </span>
                              {t(k)}
                            </span>
                          </motion.li>
                        ))}
                      </motion.ol>
                      <motion.div variants={itemV} className="mt-5 flex flex-col gap-2">
                        <Button
                          type="button"
                          onClick={tryYourself}
                          className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
                        >
                          {t('tour.s4.cta')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={loadSampleAndClose}
                          className="text-muted-foreground"
                        >
                          {t('tour.s4.sample')}
                        </Button>
                      </motion.div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* footer: dots + nav */}
              <div className="mt-6 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => goTo(step - 1)}
                  disabled={step === 0}
                  className="text-muted-foreground disabled:opacity-0"
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  {t('tour.back')}
                </Button>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: STEP_COUNT }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={t('tour.stepN', { n: i + 1, m: STEP_COUNT })}
                      onClick={() => goTo(i)}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-300',
                        i === step ? 'w-5 bg-primary' : 'w-1.5 bg-white/25 hover:bg-white/45',
                      )}
                    />
                  ))}
                </div>
                {step < STEP_COUNT - 1 ? (
                  <Button type="button" size="sm" onClick={() => goTo(step + 1)}>
                    {t('tour.next')}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <span className="w-[52px]" aria-hidden />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* full before/after browser (opened from step 3; lives outside the
          overlay so it survives the tour closing) */}
      <ExampleDialog open={exampleOpen} onOpenChange={setExampleOpen} />
    </>
  );
}

/** Gradient tour icon that pops in and then floats gently. */
function TourIcon({
  icon: Icon,
  variants,
  reduce,
}: {
  icon: typeof Printer;
  variants: Variants;
  reduce: boolean | null;
}) {
  return (
    <motion.div
      variants={variants}
      className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30"
    >
      <motion.span
        animate={reduce ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
        className="flex"
      >
        <Icon className="h-7 w-7 text-white" />
      </motion.span>
    </motion.div>
  );
}
