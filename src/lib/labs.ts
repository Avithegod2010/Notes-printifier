/**
 * labs.ts — the "Labs" experiment channel.
 *
 * The app ships two lines: the STABLE experience (what beginners get) and
 * LABS — experimental features that are off by default and only affect the
 * device that opts in. Every new/experimental feature should be gated behind
 * a flag here so `main` can move fast without destabilizing beginners.
 *
 * Currently gated:
 *  - rememberSettings: persist Enhance (filters) + Layout choices to
 *    localStorage and restore them on the next visit.
 *  - textRepaint: experimental OCR "text repaint" — recognized text is
 *    re-typeset as crisp black-on-white instead of a re-compressed scan.
 *
 * To add a new lab feature: add a field to LabsFlags + a loader/saver, a
 * switch in labs-popover.tsx, and gate the feature code on the store flag.
 */

const LS_FLAG = 'printifier.labs.rememberSettings';
const LS_REPAINT_FLAG = 'printifier.labs.textRepaint';
const LS_PREFS = 'printifier.saved-prefs.v1';

interface SavedPrefs {
  filters?: unknown;
  layout?: unknown;
}

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // private mode / storage disabled
  }
}

export function loadRememberFlag(): boolean {
  return ls()?.getItem(LS_FLAG) === '1';
}

export function saveRememberFlag(on: boolean): void {
  const s = ls();
  if (!s) return;
  if (on) s.setItem(LS_FLAG, '1');
  else {
    s.removeItem(LS_FLAG);
    s.removeItem(LS_PREFS); // opting out clears the saved prefs too
  }
}

export function loadTextRepaintFlag(): boolean {
  return ls()?.getItem(LS_REPAINT_FLAG) === '1';
}

export function saveTextRepaintFlag(on: boolean): void {
  const s = ls();
  if (!s) return;
  if (on) s.setItem(LS_REPAINT_FLAG, '1');
  else s.removeItem(LS_REPAINT_FLAG);
}

export function loadSavedPrefs(): SavedPrefs | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(LS_PREFS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPrefs;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function savePrefs(filters: unknown, layout: unknown): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(LS_PREFS, JSON.stringify({ filters, layout } satisfies SavedPrefs));
  } catch {
    // quota errors are non-fatal
  }
}

