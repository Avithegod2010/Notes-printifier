/**
 * Rough paper + ink money-savings estimate (Indian rupees).
 *
 * Assumptions (kept conservative and printed in the UI):
 *  - paper: ~₹1 per A4 sheet (bulk xerox paper)
 *  - ink:   ~₹1.30 for a 100%-coverage page; cost scales with measured
 *           coverage, so a typical dark slide (~95%) costs ~₹1.24 while a
 *           filtered page costs proportionally less.
 */

const PAPER_RS_PER_SHEET = 1;
const INK_RS_PER_FULL_PAGE = 1.3;

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

export function estimateSavings(i: SavingsInput): SavingsEstimate {
  const sheetsSaved = Math.max(0, i.inputPages - i.outputPages);
  const beforeInk = Math.min(100, Math.max(0, i.beforeInkPct ?? 90)) / 100;
  const inkSaved = Math.min(100, Math.max(0, i.inkSavedPct)) / 100;
  const inkRupees = i.inputPages * beforeInk * INK_RS_PER_FULL_PAGE * inkSaved;
  const rupees = Math.max(0, Math.round(sheetsSaved * PAPER_RS_PER_SHEET + inkRupees));
  return { sheetsSaved, rupees };
}

export function formatRupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
