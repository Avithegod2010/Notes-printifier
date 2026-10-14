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
 */

import { estimateSavings } from './savings';

const LS_KEY = 'printifier.inkstats.v1';

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

export const CO2_G_PER_SHEET = 5;
export const SHEETS_PER_TREE = 8333;

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

/** Add one finished job to the lifetime totals. */
export function recordJob(i: {
  inputPages: number;
  outputPages: number;
  inkSavedPct: number;
  beforeInkPct?: number;
}): InkStats {
  const cur = loadInkStats();
  const job = estimateSavings(i);
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
  return next;
}

/** Wipe the lifetime totals (used by the little reset link). */
export function resetInkStats(): void {
  ls()?.removeItem(LS_KEY);
}

/** Trees equivalent for a number of saved sheets (2 decimals). */
export function treesFor(sheetsSaved: number): number {
  return Math.round((sheetsSaved / SHEETS_PER_TREE) * 100) / 100;
}

/** CO₂ saved in grams for a number of saved sheets. */
export function co2GramsFor(sheetsSaved: number): number {
  return sheetsSaved * CO2_G_PER_SHEET;
}
