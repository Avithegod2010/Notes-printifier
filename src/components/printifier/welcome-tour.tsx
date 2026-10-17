'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
import { THEMES, useThemeStore, type ThemeId } from '@/lib/theme';
import { usePrintifyStore } from '@/lib/printify-store';
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
};

/**
 * WelcomeTour — first-visit guided intro: what Printifier is → make it yours
 * (live theme swatches) → a real before/after example → try it yourself.
 * Auto-opens once per device (localStorage), replayable via the ⌘K palette
 * or the `printifier:tour` window event.
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

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(LS_SEEN, '2');
    } catch {
      // private mode — tour will simply re-offer next visit
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
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

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onClick={close}
          role="presentation"
        >
          <div
            ref={cardRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('tour.aria')}
            onClick={(e) => e.stopPropagation()}
            className="holo-ring relative w-full max-w-md rounded-3xl border border-white/12 bg-popover/95 p-6 shadow-2xl shadow-black/60 outline-none"
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
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
                initial={reduced ? false : { opacity: 0, x: 26 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? undefined : { opacity: 0, x: -26 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {step === 0 && (
                  <div>
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
                      <Printer className="h-7 w-7 text-white" />
                    </div>
                    <h2 className="text-xl font-extrabold tracking-tight">
                      {t('tour.s1.t')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t('tour.s1.b')}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {(
                        [
                          { icon: Layers, k: 'tour.s1.c1' },
                          { icon: Droplets, k: 'tour.s1.c2' },
                          { icon: BookOpenCheck, k: 'tour.s1.c3' },
                          { icon: Lock, k: 'tour.s1.c4' },
                        ] as const
                      ).map(({ icon: Icon, k }) => (
                        <Badge
                          key={k}
                          variant="outline"
                          className="border-white/15 bg-white/5 font-normal"
                        >
                          <Icon className="mr-1 h-3 w-3 text-primary" />
                          {t(k)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div>
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
                      <Palette className="h-7 w-7 text-white" />
                    </div>
                    <h2 className="text-xl font-extrabold tracking-tight">
                      {t('tour.s2.t')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t('tour.s2.b')}
                    </p>
                    <div
                      className="mt-4 grid grid-cols-6 gap-2"
                      role="group"
                      aria-label={t('tour.s2.hint')}
                    >
                      {THEMES.map((th) => (
                        <button
                          key={th.id}
                          type="button"
                          title={t(THEME_NAME_KEY[th.id])}
                          aria-label={t(THEME_NAME_KEY[th.id])}
                          aria-pressed={themeId === th.id}
                          onClick={() => setTheme(th.id)}
                          className={cn(
                            'relative mx-auto h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            themeId === th.id
                              ? 'border-white/70 shadow-lg'
                              : 'border-white/20',
                          )}
                          style={{
                            background: `linear-gradient(135deg, ${th.swatch[0]} 0% 55%, ${th.swatch[2]} 55% 100%)`,
                          }}
                        >
                          {themeId === th.id && (
                            <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-md" />
                          )}
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      {t('tour.s2.hint')}
                    </p>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
                      <Play className="h-7 w-7 text-white" />
                    </div>
                    <h2 className="text-xl font-extrabold tracking-tight">
                      {t('tour.s3.t')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t('tour.s3.b')}
                    </p>

                    {/* mini before/after mock of the bundled sample */}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 p-2">
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
                      </div>
                      <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.05] p-2">
                        <div className="aspect-[4/3] w-full rounded-md bg-white p-2">
                          <div className="grid grid-cols-3 gap-1">
                            {[0, 1, 2].map((i) => (
                              <div
                                key={i}
                                className="aspect-[4/3] rounded-[3px] bg-zinc-800 p-1"
                              >
                                <div className="h-0.5 w-3/4 rounded bg-white/40" />
                                <div className="mt-0.5 h-0.5 w-1/2 rounded bg-white/20" />
                              </div>
                            ))}
                          </div>
                          <div className="mt-1.5 h-0.5 w-3/4 rounded bg-zinc-300" />
                          <div className="mt-1 h-0.5 w-1/2 rounded bg-zinc-200" />
                        </div>
                        <p className="mt-1.5 text-center text-[10px] text-emerald-300">
                          {t('tour.s3.after', { n: DEMO_AFTER })}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        {t('tour.s3.pages', { n: DEMO_PAGES_SAVED })}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                      >
                        <Check className="mr-1 h-3 w-3" />
                        {t('tour.s3.ink')}
                      </Badge>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
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
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
                      <SlidersHorizontal className="h-7 w-7 text-white" />
                    </div>
                    <h2 className="text-xl font-extrabold tracking-tight">
                      {t('tour.s4.t')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t('tour.s4.b')}
                    </p>
                    <ol className="mt-4 space-y-2">
                      {(
                        [
                          { icon: FileUp, k: 'tour.s4.s1' },
                          { icon: SlidersHorizontal, k: 'tour.s4.s2' },
                          { icon: Printer, k: 'tour.s4.s3' },
                        ] as const
                      ).map(({ icon: Icon, k }, i) => (
                        <li key={k} className="flex items-center gap-2.5 text-sm">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span>
                            <span className="mr-1.5 font-semibold text-primary">
                              {i + 1}.
                            </span>
                            {t(k)}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-5 flex flex-col gap-2">
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
                    </div>
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
          </div>
        </div>
      )}

      {/* full before/after browser (opened from step 3; lives outside the
          overlay so it survives the tour closing) */}
      <ExampleDialog open={exampleOpen} onOpenChange={setExampleOpen} />
    </>
  );
}
