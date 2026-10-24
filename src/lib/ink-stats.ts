/**
 * ink-stats.ts — the personal "impact meter".
 *
 * Every finished conversion adds to a running, on-device total: sheets of
 * paper avoided, rupees saved, and what that means in trees + CO₂. Stored in
 * localStorage — nothing ever leaves the device (the anonymous /api/prints
 * POST is a separate, optional thing).
 *
 * Model reuses src/lib/savings.ts so the per-job numbers and the cumulative
 * numbers never drift apart. Ecological factors (industry-standard estimates):
 *   - 1 A4 sheet ≈ 5 g CO₂e (production + transport)
 *   - 1 tree    ≈ 8,333 A4 sheets
 *
 * F7 adds a lightweight per-job timestamp log that powers the weekly streak
 * and sheet-milestone tiers shown on the result screen + receipt.
 */

import { estimateSavings, loadCostProfile } from './savings';

const LS_KEY = 'printifier.inkstats.v1';
const LS_LOG_KEY = 'printifier.impactlog.v1';
const LOG_CAP = 400; // ~2 jobs/week for 4 years — tiny and bounded

export interface InkStats {
  /** Finished conversions counted. */
  jobs: number;
  inputPages: number;
  outputPages: number;
  /** Sum of per-job savings (sheets of paper avoided). */
  sheetsSaved: number;
  /** Sum of per-job rupee estimates. */
  rupees: number;
  ts: number;
}

const EMPTY: InkStats = {
  jobs: 0,
  inputPages: 0,
  outputPages: 0,
  sheetsSaved: 0,
  rupees: 0,
  ts: 0,
};

const CO2_G_PER_SHEET = 5;
const SHEETS_PER_TREE = 8333;

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadInkStats(): InkStats {
  const s = ls();
  if (!s) return { ...EMPTY };
  try {
    const raw = s.getItem(LS_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<InkStats>;
    if (typeof p !== 'object' || p === null) return { ...EMPTY };
    return {
      jobs: Number(p.jobs) || 0,
      inputPages: Number(p.inputPages) || 0,
      outputPages: Number(p.outputPages) || 0,
      sheetsSaved: Number(p.sheetsSaved) || 0,
      rupees: Number(p.rupees) || 0,
      ts: Number(p.ts) || 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

// ---------------------------------------------------------------------------
// Job log + streak + milestones (F7)
// ---------------------------------------------------------------------------

/** Timestamp of Monday 00:00 local time for the week containing `ts`. */
function weekStart(ts: number): number {
  const d = new Date(ts);
  const dow = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function loadJobLog(): number[] {
  const s = ls();
  if (!s) return [];
  try {
    const raw = s.getItem(LS_LOG_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(-LOG_CAP);
  } catch {
    return [];
  }
}

function appendJobLog(ts: number): void {
  const s = ls();
  if (!s) return;
  try {
    const log = [...loadJobLog(), ts].slice(-LOG_CAP);
    s.setItem(LS_LOG_KEY, JSON.stringify(log));
  } catch {
    // quota — non-fatal
  }
}

interface StreakInfo {
  /** Jobs finished in the current Mon–Sun week. */
  weekCount: number;
  /** Sheets saved in the current week. */
  weekSheets: number;
  /**
   * Consecutive Mon–Sun weeks (ending this week — or last week, so a streak
   * doesn't snap to zero on Monday morning before the first conversion).
   */
  streakWeeks: number;
  /** Total logged jobs. */
  totalJobs: number;
}

export function computeStreak(log: number[], sheetsPerJob?: Map<number, number>): StreakInfo {
  const now = Date.now();
  const curWeek = weekStart(now);
  const prevWeek = curWeek - 7 * 24 * 60 * 60 * 1000;

  let weekCount = 0;
  let weekSheets = 0;
  const activeWeeks = new Set<number>();
  for (const ts of log) {
    activeWeeks.add(weekStart(ts));
    if (weekStart(ts) === curWeek) {
      weekCount++;
      weekSheets += sheetsPerJob?.get(ts) ?? 0;
    }
  }

  let streakWeeks = 0;
  if (activeWeeks.has(curWeek)) {
    streakWeeks = 1;
    let w = curWeek;
    while (activeWeeks.has((w -= 7 * 24 * 60 * 60 * 1000))) streakWeeks++;
  } else if (activeWeeks.has(prevWeek)) {
    streakWeeks = 1;
    let w = prevWeek;
    while (activeWeeks.has((w -= 7 * 24 * 60 * 60 * 1000))) streakWeeks++;
  }

  return { weekCount, weekSheets, streakWeeks, totalJobs: log.length };
}

/** Milestone tiers for lifetime sheets saved. */
const SHEET_TIERS: Array<{ sheets: number; key: string }> = [
  { sheets: 10, key: 'im.tier.bronze' },
  { sheets: 50, key: 'im.tier.silver' },
  { sheets: 100, key: 'im.tier.gold' },
  { sheets: 250, key: 'im.tier.platinum' },
  { sheets: 500, key: 'im.tier.diamond' },
  { sheets: 1000, key: 'im.tier.legend' },
];

interface MilestoneInfo {
  /** Lifetime sheets that define the current tier (0 = none yet). */
  currentTierSheets: number;
  /** i18n key of the current tier, or null when below Bronze. */
  tierKey: string | null;
  /** i18n key of the next tier, or null when Legend reached. */
  nextKey: string | null;
  /** Sheets still needed for the next tier (0 at Legend). */
  sheetsToNext: number;
  /** 0–100 progress toward the next tier (100 at Legend). */
  progressPct: number;
}

export function milestoneFor(lifetimeSheets: number): MilestoneInfo {
  const idx = SHEET_TIERS.findIndex((t) => lifetimeSheets < t.sheets);
  if (idx === -1) {
    return {
      currentTierSheets: SHEET_TIERS[SHEET_TIERS.length - 1].sheets,
      tierKey: SHEET_TIERS[SHEET_TIERS.length - 1].key,
      nextKey: null,
      sheetsToNext: 0,
      progressPct: 100,
    };
  }
  const next = SHEET_TIERS[idx];
  const prev = idx > 0 ? SHEET_TIERS[idx - 1].sheets : 0;
  return {
    currentTierSheets: prev,
    tierKey: idx > 0 ? SHEET_TIERS[idx - 1].key : null,
    nextKey: next.key,
    sheetsToNext: next.sheets - lifetimeSheets,
    progressPct: Math.max(
      3,
      Math.min(100, Math.round(((lifetimeSheets - prev) / (next.sheets - prev)) * 100)),
    ),
  };
}

/** Add one finished job to the lifetime totals. */
export function recordJob(i: {
  inputPages: number;
  outputPages: number;
  inkSavedPct: number;
  beforeInkPct?: number;
}): InkStats {
  const cur = loadInkStats();
  const job = estimateSavings(i, loadCostProfile());
  const next: InkStats = {
    jobs: cur.jobs + 1,
    inputPages: cur.inputPages + Math.max(0, i.inputPages),
    outputPages: cur.outputPages + Math.max(0, i.outputPages),
    sheetsSaved: cur.sheetsSaved + job.sheetsSaved,
    rupees: cur.rupees + job.rupees,
    ts: Date.now(),
  };
  const s = ls();
  if (s) {
    try {
      s.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // quota — non-fatal
    }
  }
  appendJobLog(next.ts);
  return next;
}

/** Wipe the lifetime totals (used by the little reset link). */
export function resetInkStats(): void {
  const s = ls();
  s?.removeItem(LS_KEY);
  s?.removeItem(LS_LOG_KEY);
}

/**
 * Restore lifetime totals from a backup file (backup.ts). Numbers are
 * re-sanitized exactly like loadInkStats so a tampered file can't inject
 * NaN/negatives into the impact meter.
 */
export function saveInkStats(stats: InkStats): void {
  const s = ls();
  if (!s) return;
  const clean: InkStats = {
    jobs: Math.max(0, Number(stats.jobs) || 0),
    inputPages: Math.max(0, Number(stats.inputPages) || 0),
    outputPages: Math.max(0, Number(stats.outputPages) || 0),
    sheetsSaved: Math.max(0, Number(stats.sheetsSaved) || 0),
    rupees: Math.max(0, Number(stats.rupees) || 0),
    ts: Math.max(0, Number(stats.ts) || 0),
  };
  try {
    s.setItem(LS_KEY, JSON.stringify(clean));
  } catch {
    // quota — non-fatal
  }
}

/** Restore the impact job log from a backup (same sanitizing as loadJobLog). */
export function saveJobLog(log: number[]): void {
  const s = ls();
  if (!s) return;
  try {
    const clean = (Array.isArray(log) ? log : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(-LOG_CAP);
    s.setItem(LS_LOG_KEY, JSON.stringify(clean));
  } catch {
    // quota — non-fatal
  }
}

/** Trees equivalent for a number of saved sheets (2 decimals). */
export function treesFor(sheetsSaved: number): number {
  return Math.round((sheetsSaved / SHEETS_PER_TREE) * 100) / 100;
}

/** CO₂ saved in grams for a number of saved sheets. */
export function co2GramsFor(sheetsSaved: number): number {
  return sheetsSaved * CO2_G_PER_SHEET;
}
