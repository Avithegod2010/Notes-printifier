/**
 * Paper + ink money-savings estimate (Indian rupees).
 *
 * Rates come from the user's editable "print cost profile" (F5) — ask your
 * print shop once and every ₹ number becomes exact. Defaults stay
 * conservative and match the old printed assumption:
 *  - paper: ~₹1 per A4 sheet (bulk xerox paper)
 *  - ink:   ~₹1.30 for a 100%-coverage page; cost scales with measured
 *           coverage, so a typical dark slide (~95%) costs ~₹1.24 while a
 *           filtered page costs proportionally less.
 */

const LS_COST_KEY = 'printifier.cost.v1';

export interface CostProfile {
  /** ₹ per A4 sheet (paper). */
  paperRsPerSheet: number;
  /** ₹ for a page printed at 100% ink coverage. */
  inkRsPerFullPage: number;
}

export const DEFAULT_COST: CostProfile = {
  paperRsPerSheet: 1,
  inkRsPerFullPage: 1.3,
};

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function clampRate(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 500) return fallback;
  return Math.round(n * 100) / 100;
}

export function loadCostProfile(): CostProfile {
  const s = ls();
  if (!s) return { ...DEFAULT_COST };
  try {
    const raw = s.getItem(LS_COST_KEY);
    if (!raw) return { ...DEFAULT_COST };
    const p = JSON.parse(raw) as Partial<CostProfile> | null;
    if (!p || typeof p !== 'object') return { ...DEFAULT_COST };
    return {
      paperRsPerSheet: clampRate(p.paperRsPerSheet, DEFAULT_COST.paperRsPerSheet),
      inkRsPerFullPage: clampRate(p.inkRsPerFullPage, DEFAULT_COST.inkRsPerFullPage),
    };
  } catch {
    return { ...DEFAULT_COST };
  }
}

export function saveCostProfile(p: CostProfile): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(
      LS_COST_KEY,
      JSON.stringify({
        paperRsPerSheet: clampRate(p.paperRsPerSheet, DEFAULT_COST.paperRsPerSheet),
        inkRsPerFullPage: clampRate(p.inkRsPerFullPage, DEFAULT_COST.inkRsPerFullPage),
      }),
    );
  } catch {
    // quota — non-fatal
  }
}

export function costProfileIsDefault(p: CostProfile): boolean {
  return (
    Math.abs(p.paperRsPerSheet - DEFAULT_COST.paperRsPerSheet) < 0.005 &&
    Math.abs(p.inkRsPerFullPage - DEFAULT_COST.inkRsPerFullPage) < 0.005
  );
}

export interface SavingsInput {
  inputPages: number;
  outputPages: number;
  /** % ink removed by the filters (0–100). */
  inkSavedPct: number;
  /** % ink coverage of the original pages (0–100). Falls back to 90. */
  beforeInkPct?: number;
}

export interface SavingsEstimate {
  sheetsSaved: number;
  rupees: number;
}

export function estimateSavings(
  i: SavingsInput,
  cost: CostProfile = DEFAULT_COST,
): SavingsEstimate {
  const sheetsSaved = Math.max(0, i.inputPages - i.outputPages);
  const beforeInk = Math.min(100, Math.max(0, i.beforeInkPct ?? 90)) / 100;
  const inkSaved = Math.min(100, Math.max(0, i.inkSavedPct)) / 100;
  const inkRupees = i.inputPages * beforeInk * cost.inkRsPerFullPage * inkSaved;
  const rupees = Math.max(
    0,
    Math.round(sheetsSaved * cost.paperRsPerSheet + inkRupees),
  );
  return { sheetsSaved, rupees };
}

export function formatRupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
