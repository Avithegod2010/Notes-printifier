'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BadgeCheck,
  CalendarRange,
  IndianRupee,
  Lock,
  Leaf,
  Printer,
  Sparkles,
  Trees,
  Wind,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHead } from './section-head';
import { Reveal } from './reveal';
import { useT } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';
import {
  co2GramsFor,
  computeStreak,
  loadInkStats,
  loadJobLog,
  resetInkStats,
  treesFor,
} from '@/lib/ink-stats';
import { cn } from '@/lib/utils';

/**
 * ImpactDashboard — the private, on-device savings dashboard.
 *
 * Lifetime totals (sheets / rupees / CO₂ / trees), a last-8-weeks activity
 * chart built from the job log, and a badge gallery that unlocks as the
 * numbers grow. All data comes from localStorage — nothing leaves the phone.
 */

const WEEKS_SHOWN = 8;

interface WeekBar {
  label: string;
  count: number;
  /** 0..1 relative to the tallest week */
  h: number;
}

function buildWeekBars(log: number[]): WeekBar[] {
  const start = (ts: number) => {
    const d = new Date(ts);
    const dow = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dow);
    return d.getTime();
  };
  const now = Date.now();
  const thisWeek = start(now);
  const weeks: number[] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) weeks.push(thisWeek - i * 7 * 864e5);
  const counts = weeks.map((w) => log.filter((ts) => start(ts) === w).length);
  const max = Math.max(1, ...counts);
  return weeks.map((w, i) => ({
    label: new Date(w).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    count: counts[i],
    h: counts[i] / max,
  }));
}

interface BadgeDef {
  id: string;
  nameKey: string;
  descKey: string;
  earned: boolean;
  icon: typeof Award;
}

function buildBadges(stats: { jobs: number; sheetsSaved: number }, streakWeeks: number): BadgeDef[] {
  return [
    { id: 'first', nameKey: 'bg.first', descKey: 'bg.firstD', earned: stats.jobs >= 1, icon: Printer },
    { id: 'ten', nameKey: 'bg.ten', descKey: 'bg.tenD', earned: stats.jobs >= 10, icon: Printer },
    { id: 'fifty', nameKey: 'bg.fifty', descKey: 'bg.fiftyD', earned: stats.jobs >= 50, icon: Printer },
    { id: 's50', nameKey: 'bg.s50', descKey: 'bg.s50D', earned: stats.sheetsSaved >= 50, icon: Leaf },
    { id: 's250', nameKey: 'bg.s250', descKey: 'bg.s250D', earned: stats.sheetsSaved >= 250, icon: Trees },
    { id: 's1000', nameKey: 'bg.s1000', descKey: 'bg.s1000D', earned: stats.sheetsSaved >= 1000, icon: Trees },
    { id: 'w2', nameKey: 'bg.w2', descKey: 'bg.w2D', earned: streakWeeks >= 2, icon: CalendarRange },
    { id: 'w4', nameKey: 'bg.w4', descKey: 'bg.w4D', earned: streakWeeks >= 4, icon: CalendarRange },
    { id: 'w8', nameKey: 'bg.w8', descKey: 'bg.w8D', earned: streakWeeks >= 8, icon: CalendarRange },
  ];
}

export function ImpactDashboard() {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState({ jobs: 0, inputPages: 0, outputPages: 0, sheetsSaved: 0, rupees: 0 });
  const [bars, setBars] = useState<WeekBar[]>([]);
  const [streak, setStreak] = useState({ weekCount: 0, weekSheets: 0, streakWeeks: 0, totalJobs: 0 });

  useEffect(() => {
    const s = loadInkStats();
    const log = loadJobLog();
    setStats({
      jobs: s.jobs,
      inputPages: s.inputPages,
      outputPages: s.outputPages,
      sheetsSaved: s.sheetsSaved,
      rupees: s.rupees,
    });
    setBars(buildWeekBars(log));
    setStreak(computeStreak(log));
    setMounted(true);
  }, []);

  const badges = useMemo(
    () => buildBadges(stats, streak.streakWeeks),
    [stats, streak.streakWeeks],
  );
  const earnedCount = badges.filter((b) => b.earned).length;

  const hasData = mounted && stats.jobs > 0;

  const cards = [
    { icon: Leaf, label: t('db.sheets'), value: stats.sheetsSaved.toLocaleString('en-IN'), tone: 'text-emerald-300' },
    { icon: IndianRupee, label: t('db.rupees'), value: `₹${Math.round(stats.rupees).toLocaleString('en-IN')}`, tone: 'text-emerald-300' },
    { icon: Wind, label: t('db.co2'), value: `${(co2GramsFor(stats.sheetsSaved) / 1000).toFixed(2)} kg`, tone: 'text-violet-300' },
    { icon: Trees, label: t('db.trees'), value: treesFor(stats.sheetsSaved).toFixed(2), tone: 'text-violet-300' },
  ];

  return (
    <section
      id="impact"
      aria-label={t('db.title')}
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-14"
    >
      <SectionHead eyebrow="db.eyebrow" title="db.title" sub="db.sub" />

      {!hasData ? (
        <Reveal>
          <div className="mt-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
            <Sparkles className="h-6 w-6 text-violet-300" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">{t('db.empty')}</p>
          </div>
        </Reveal>
      ) : (
        <>
          {/* lifetime totals */}
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c, i) => (
              <Reveal key={c.label} delay={i * 0.06}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-violet-500/40">
                  <c.icon className={cn('mb-2 h-5 w-5', c.tone)} aria-hidden="true" />
                  <p className="text-2xl font-extrabold tracking-tight">{c.value}</p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">{c.label}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            {/* weekly activity chart */}
            <Reveal>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarRange className="h-4 w-4 text-violet-300" /> {t('db.weeks')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('db.jobs')}: <span className="font-bold text-foreground">{stats.jobs}</span>
                  </p>
                </div>
                <div className="mt-4 flex h-32 items-end gap-2" role="img" aria-label={t('db.weeks')}>
                  {bars.map((b, i) => (
                    <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                      <span className="text-[10px] font-bold text-muted-foreground">{b.count}</span>
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-violet-600/70 to-fuchsia-500/70 transition-all"
                        style={{ height: `${Math.max(4, b.h * 88)}px` }}
                      />
                      <span className="w-full truncate text-center text-[9px] leading-none text-muted-foreground">
                        {b.label}
                      </span>
                    </div>
                  ))}
                </div>
                {streak.streakWeeks > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    🔥 {t('im.streak.weeks', { n: streak.streakWeeks })} ·{' '}
                    {t('im.streak.thisweek', { n: streak.weekCount })}
                  </p>
                )}
              </div>
            </Reveal>

            {/* badge gallery */}
            <Reveal delay={0.08}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Award className="h-4 w-4 text-violet-300" /> {t('bg.title')}
                  </p>
                  <Badge variant="outline" className="border-white/15 text-[10px] text-muted-foreground">
                    {earnedCount}/{badges.length}
                  </Badge>
                </div>
                <ul className="pretty-scroll mt-3 grid max-h-52 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  {badges.map((b) => (
                    <li key={b.id}>
                      <div
                        title={t(b.descKey)}
                        className={cn(
                          'flex h-full flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors',
                          b.earned
                            ? 'border-violet-400/40 bg-violet-500/10'
                            : 'border-white/10 bg-white/[0.02] opacity-60',
                        )}
                      >
                        {b.earned ? (
                          <b.icon className="h-4 w-4 text-violet-300" aria-hidden="true" />
                        ) : (
                          <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        )}
                        <p className={cn('text-[10px] font-bold leading-tight', !b.earned && 'text-muted-foreground')}>
                          {t(b.nameKey)}
                        </p>
                        <p className="text-[9px] leading-tight text-muted-foreground">{t(b.descKey)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <BadgeCheck className="h-3 w-3" aria-hidden="true" /> {t('bg.sub')}
                </p>
              </div>
            </Reveal>
          </div>

          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-[11px] text-muted-foreground hover:text-red-300"
              onClick={() => {
                resetInkStats();
                setStats({ jobs: 0, inputPages: 0, outputPages: 0, sheetsSaved: 0, rupees: 0 });
                setBars([]);
                toast({ description: t('db.resetDone') });
              }}
            >
              {t('db.reset')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
