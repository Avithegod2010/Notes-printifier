'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';
import {
  Calculator,
  FileStack,
  GraduationCap,
  PiggyBank,
  Printer,
  Store,
} from 'lucide-react';
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
 * Interactive savings estimator — v2. Runs entirely client-side.
 *
 * Two "where do you print" modes:
 *  • Photocopy shop — you pay per printed SIDE. Typical Indian rates are
 *    used: ₹1 for a plain B&W page, ₹2 for a dense 2-slides-per-side print,
 *    ₹5 for a full dark colour slide. Printifier output (3 bright slides
 *    per sheet) is billed at the plain B&W rate → you pay for ~⅓ pages.
 *  • Own printer — paper + ink model:
 *      sheets/year = pagesPerWeek × 52 ÷ slides-per-sheet
 *      ₹/year      = savedSheets × ₹1 paper + pages × ₹1.3 × (coverageNow − coveragePrintifier)
 *    Rates come from the user's editable print cost profile (F5) when set.
 *
 * A period selector (semester / year / whole degree) scales everything, and
 * a degree projection line shows the 4-year total.
 */

const PRINTIFIER_PER_SHEET = 3;
const PRINTIFIER_COVERAGE = 0.22;

const STYLES = [
  { id: 'dark', key: 'calc.styleDark', perSheet: 1, coverage: 0.95 },
  { id: 'two', key: 'calc.styleTwo', perSheet: 2, coverage: 0.55 },
  { id: 'gray', key: 'calc.styleGray', perSheet: 2, coverage: 0.3 },
] as const;

type StyleId = (typeof STYLES)[number]['id'];

/** ₹ per printed SIDE at a typical Indian photocopy shop, by today's style. */
const SHOP_RATE_TODAY: Record<StyleId, number> = { dark: 5, two: 2, gray: 1 };
/** Printifier output is mostly-white B&W → billed at the cheapest rate. */
const SHOP_RATE_PRINTIFIER = 1;

const PERIODS = [
  { id: 'sem', key: 'calc.pSem', months: 6 },
  { id: 'year', key: 'calc.pYear', months: 12 },
  { id: 'degree', key: 'calc.pDegree', months: 48 },
] as const;

type PeriodId = (typeof PERIODS)[number]['id'];
type Where = 'shop' | 'own';

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
  const [where, setWhere] = useState<Where>('shop');
  const [periodId, setPeriodId] = useState<PeriodId>('year');
  // F5 — honour the user's print cost profile (₹/sheet, ₹/full-ink page)
  const [cost, setCost] = useState<CostProfile | null>(null);
  useEffect(() => {
    setCost(loadCostProfile());
  }, []);
  const paperRs = cost?.paperRsPerSheet ?? 1;
  const inkRs = cost?.inkRsPerFullPage ?? 1.3;
  const customCost = where === 'own' && cost !== null && !costProfileIsDefault(cost);

  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];
  const period = PERIODS.find((p) => p.id === periodId) ?? PERIODS[1];

  const result = useMemo(() => {
    const weeks = (period.months / 12) * 52;
    const pagesPeriod = Math.round(pages * weeks);
    const sheetsToday = pagesPeriod / style.perSheet;
    const sheetsWith = pagesPeriod / PRINTIFIER_PER_SHEET;
    const sheetsSaved = Math.max(0, sheetsToday - sheetsWith);

    let money = 0;
    let paperSaved = 0;
    let inkSaved = 0;
    let sidesToday = 0;
    let sidesWith = 0;

    if (where === 'shop') {
      // pay per printed side
      sidesToday = Math.round(sheetsToday);
      sidesWith = Math.round(sheetsWith);
      const todayCost = sidesToday * SHOP_RATE_TODAY[styleId];
      const withCost = sidesWith * SHOP_RATE_PRINTIFIER;
      money = Math.max(0, todayCost - withCost);
    } else {
      // own printer: paper + coverage-scaled ink
      paperSaved = sheetsSaved * paperRs;
      inkSaved = Math.max(
        0,
        pagesPeriod * inkRs * (style.coverage - PRINTIFIER_COVERAGE),
      );
      money = paperSaved + inkSaved;
      sidesToday = Math.round(sheetsToday);
      sidesWith = Math.round(sheetsWith);
    }

    return {
      sheetsToday: Math.round(sheetsToday),
      sheetsWith: Math.round(sheetsWith),
      sheetsSaved: Math.round(sheetsSaved),
      paperSaved,
      inkSaved,
      sidesToday,
      sidesWith,
      money: Math.max(0, Math.round(money / 10) * 10),
      degreeMoney: Math.max(0, Math.round(((money / period.months) * 48) / 10) * 10),
      degreeSheets: Math.round((sheetsSaved / period.months) * 48),
    };
  }, [pages, style, styleId, where, period, paperRs, inkRs]);

  // bar widths (today is always the full reference)
  const withPct = result.sheetsToday > 0 ? (result.sheetsWith / result.sheetsToday) * 100 : 100;

  const chip = (
    selected: boolean,
  ) => `flex min-h-[42px] w-full items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    selected
      ? 'border-violet-400/60 bg-violet-500/10 text-foreground'
      : 'border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/25 hover:text-foreground'
  }`;

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
          <div className="flex h-full flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
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

            {/* where do you print */}
            <div
              role="radiogroup"
              aria-label={t('calc.where')}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <p className="text-sm font-semibold sm:col-span-2">{t('calc.where')}</p>
              <button
                type="button"
                role="radio"
                aria-checked={where === 'shop'}
                onClick={() => setWhere('shop')}
                className={chip(where === 'shop')}
              >
                <span className="flex items-center gap-2">
                  <Store className="h-4 w-4 shrink-0 text-fuchsia-300" aria-hidden="true" />
                  {t('calc.whereShop')}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${
                    where === 'shop' ? 'border-violet-300 bg-violet-400' : 'border-white/25'
                  }`}
                >
                  {where === 'shop' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={where === 'own'}
                onClick={() => setWhere('own')}
                className={chip(where === 'own')}
              >
                <span className="flex items-center gap-2">
                  <Printer className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  {t('calc.whereOwn')}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${
                    where === 'own' ? 'border-violet-300 bg-violet-400' : 'border-white/25'
                  }`}
                >
                  {where === 'own' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </button>
            </div>

            {/* period */}
            <div role="radiogroup" aria-label={t('calc.period')} className="space-y-2">
              <p className="text-sm font-semibold">{t('calc.period')}</p>
              <div className="grid grid-cols-3 gap-2">
                {PERIODS.map((p) => {
                  const selected = p.id === periodId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPeriodId(p.id)}
                      className={`min-h-[42px] rounded-2xl border px-2 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selected
                          ? 'border-violet-400/60 bg-violet-500/10 text-foreground'
                          : 'border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/25 hover:text-foreground'
                      }`}
                    >
                      {t(p.key)}
                    </button>
                  );
                })}
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
                    className={chip(selected)}
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
                <PiggyBank className="mx-auto mb-2 h-5 w-5 text-fuchsia-400" aria-hidden="true" />
                <p className="text-3xl font-extrabold tracking-tight text-fuchsia-300 sm:text-4xl">
                  <AnimatedNumber value={result.money} prefix="₹" />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('calc.rupeesSaved')}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center sm:p-5">
                <FileStack className="mx-auto mb-2 h-5 w-5 text-emerald-400" aria-hidden="true" />
                <p className="text-3xl font-extrabold tracking-tight text-emerald-300 sm:text-4xl">
                  <AnimatedNumber value={result.sheetsSaved} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('calc.sheetsSaved')}</p>
              </div>
            </div>

            {/* breakdown — what the saving is actually made of */}
            <div className="relative mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed">
              {where === 'shop' ? (
                <p>
                  <Store className="mr-1.5 inline h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
                  {t('calc.bdShop', {
                    n: result.sidesWith.toLocaleString('en-IN'),
                    m: result.sidesToday.toLocaleString('en-IN'),
                  })}
                </p>
              ) : (
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <span aria-hidden="true" className="mr-1.5">📄</span>
                    {t('calc.bdPaper')}:{' '}
                    <strong className="font-bold text-emerald-300">
                      ₹{Math.round(result.paperSaved).toLocaleString('en-IN')}
                    </strong>
                  </span>
                  <span>
                    <span aria-hidden="true" className="mr-1.5">🖨️</span>
                    {t('calc.bdInk')}:{' '}
                    <strong className="font-bold text-violet-300">
                      ₹{Math.round(result.inkSaved).toLocaleString('en-IN')}
                    </strong>
                  </span>
                </p>
              )}
            </div>

            {/* comparison bars */}
            <div className="relative mt-5 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground">{t('calc.today')}</span>
                  <span className="font-bold">
                    {result.sheetsToday.toLocaleString('en-IN')}{' '}
                    <span className="font-medium text-muted-foreground">{t('calc.sheetsUnit')}</span>
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
                    <span className="font-medium text-muted-foreground">{t('calc.sheetsUnit')}</span>
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

            {/* 4-year projection */}
            <div className="relative mt-5 flex items-start gap-3 rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] px-4 py-3">
              <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-violet-100/90">
                {period.months < 48
                  ? t('calc.degreeLine', {
                      p: `₹${result.degreeMoney.toLocaleString('en-IN')}`,
                      n: result.degreeSheets.toLocaleString('en-IN'),
                    })
                  : t('calc.degreeAvg', {
                      p: `₹${Math.round(result.money / 4).toLocaleString('en-IN')}`,
                    })}
              </p>
            </div>

            <p className="relative mt-auto pt-5 text-[11px] leading-relaxed text-muted-foreground/80">
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
