'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import { Calculator, FileStack, PiggyBank } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  costProfileIsDefault,
  loadCostProfile,
  type CostProfile,
} from '@/lib/savings';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';
import { useT } from '@/lib/i18n';

/**
 * Interactive savings estimator. Runs entirely client-side:
 *   sheets/year = pagesPerWeek × 52 ÷ slides-per-sheet
 *   ₹/year      = savedSheets × ₹1 paper + pages × ₹1.3 × (inkCoverageNow − inkCoveragePrintifier)
 * Printifier assumption: 3 slides/sheet + ink-saver + smart invert.
 */

const PRINTIFIER_PER_SHEET = 3;
const PRINTIFIER_COVERAGE = 0.22;

const STYLES = [
  { id: 'dark', key: 'calc.styleDark', perSheet: 1, coverage: 0.95 },
  { id: 'two', key: 'calc.styleTwo', perSheet: 2, coverage: 0.55 },
  { id: 'gray', key: 'calc.styleGray', perSheet: 2, coverage: 0.3 },
] as const;

type StyleId = (typeof STYLES)[number]['id'];

/** Smoothly count-up number (respects reduced motion). */
function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
}: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const reduce = useReducedMotion();
  const spring = useSpring(0, { stiffness: 90, damping: 22, mass: 1 });
  const text = useTransform(spring, (v) =>
    `${prefix}${Math.round(v).toLocaleString('en-IN')}${suffix}`,
  );

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  if (reduce) {
    return (
      <span>
        {prefix}
        {Math.round(value).toLocaleString('en-IN')}
        {suffix}
      </span>
    );
  }
  return <motion.span>{text}</motion.span>;
}

export function SavingsCalculator() {
  const t = useT();
  const [pages, setPages] = useState(120);
  const [styleId, setStyleId] = useState<StyleId>('dark');
  // F5 — honour the user's print cost profile (₹/sheet, ₹/full-ink page)
  const [cost, setCost] = useState<CostProfile | null>(null);
  useEffect(() => {
    setCost(loadCostProfile());
  }, []);
  const paperRs = cost?.paperRsPerSheet ?? 1;
  const inkRs = cost?.inkRsPerFullPage ?? 1.3;
  const customCost = cost !== null && !costProfileIsDefault(cost);

  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];

  const result = useMemo(() => {
    const pagesYear = pages * 52;
    const sheetsToday = pagesYear / style.perSheet;
    const sheetsWith = pagesYear / PRINTIFIER_PER_SHEET;
    const sheetsSaved = Math.max(0, sheetsToday - sheetsWith);
    const money =
      sheetsSaved * paperRs +
      pagesYear * inkRs * Math.max(0, style.coverage - PRINTIFIER_COVERAGE);
    // round money to the nearest ₹10 — cleaner for an estimate
    return {
      sheetsToday: Math.round(sheetsToday),
      sheetsWith: Math.round(sheetsWith),
      sheetsSaved: Math.round(sheetsSaved),
      money: Math.max(0, Math.round(money / 10) * 10),
    };
  }, [pages, style, paperRs, inkRs]);

  // bar widths (today is always the full reference)
  const withPct = result.sheetsToday > 0 ? (result.sheetsWith / result.sheetsToday) * 100 : 100;

  return (
    <section
      id="calculator"
      aria-label={t('calc.title')}
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14"
    >
      <SectionHead
        eyebrow="calc.eyebrow"
        title="calc.title"
        sub="calc.sub"
        icon={Calculator}
      />

      <div className="mt-10 grid gap-4 lg:grid-cols-2 lg:gap-6">
        {/* inputs */}
        <Reveal>
          <div className="flex h-full flex-col gap-7 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <label
                  htmlFor="calc-pages"
                  className="text-sm font-semibold"
                >
                  {t('calc.pages')}
                </label>
                <span className="whitespace-nowrap rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-sm font-extrabold text-violet-200">
                  <AnimatedNumber value={pages} suffix=" " />
                  <span className="text-xs font-semibold text-violet-300/80">
                    {t('calc.pagesUnit')}
                  </span>
                </span>
              </div>
              <Slider
                id="calc-pages"
                min={20}
                max={400}
                step={10}
                value={[pages]}
                onValueChange={([v]) => setPages(v)}
                aria-label={t('calc.pages')}
              />
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>20</span>
                <span>400</span>
              </div>
            </div>

            <div
              role="radiogroup"
              aria-label={t('calc.style')}
              className="space-y-2"
            >
              <p className="text-sm font-semibold">{t('calc.style')}</p>
              {STYLES.map((s) => {
                const selected = s.id === styleId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setStyleId(s.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? 'border-violet-400/60 bg-violet-500/10 text-foreground'
                        : 'border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/25 hover:text-foreground'
                    }`}
                  >
                    <span className="font-medium">{t(s.key)}</span>
                    <span
                      aria-hidden="true"
                      className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${
                        selected ? 'border-violet-300 bg-violet-400' : 'border-white/25'
                      }`}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Reveal>

        {/* results */}
        <Reveal delay={0.08}>
          <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-b from-violet-500/[0.08] to-fuchsia-500/[0.04] p-6 sm:p-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-fuchsia-500/15 blur-[70px]"
            />

            <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center sm:p-5">
                <FileStack className="mx-auto mb-2 h-5 w-5 text-emerald-400" aria-hidden="true" />
                <p className="text-3xl font-extrabold tracking-tight text-emerald-300 sm:text-4xl">
                  <AnimatedNumber value={result.sheetsSaved} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('calc.sheetsSaved')}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center sm:p-5">
                <PiggyBank className="mx-auto mb-2 h-5 w-5 text-fuchsia-400" aria-hidden="true" />
                <p className="text-3xl font-extrabold tracking-tight text-fuchsia-300 sm:text-4xl">
                  <AnimatedNumber value={result.money} prefix="₹" />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('calc.rupeesSaved')}</p>
              </div>
            </div>

            {/* comparison bars */}
            <div className="relative mt-7 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground">{t('calc.today')}</span>
                  <span className="font-bold">
                    {result.sheetsToday.toLocaleString('en-IN')}{' '}
                    <span className="font-medium text-muted-foreground">{t('calc.sheetsYear')}</span>
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full w-full rounded-full bg-white/25" />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-violet-200">{t('calc.printifier')}</span>
                  <span className="font-bold">
                    {result.sheetsWith.toLocaleString('en-IN')}{' '}
                    <span className="font-medium text-muted-foreground">{t('calc.sheetsYear')}</span>
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                    animate={{ width: `${Math.max(4, withPct)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>
              <p className="text-center text-xs font-medium text-emerald-300/90">
                {t('calc.match')}
              </p>
            </div>

            <p className="relative mt-auto pt-6 text-[11px] leading-relaxed text-muted-foreground/80">
              {t('calc.note')}
              {customCost && (
                <span className="mt-1 block text-emerald-300/90">
                  {t('rs.assume2', { p: paperRs, i: inkRs })}
                </span>
              )}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
