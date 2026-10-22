/**
 * presets.ts — saved "recipes" of Enhance + Layout settings.
 *
 * Students re-print the same kinds of files over and over (same coaching
 * deck style, same booklet). A preset is a named snapshot of the full
 * settings that can be applied with one tap. Stored in localStorage —
 * nothing ever leaves the device.
 */

import { defaultFilters, type FilterSettings } from './pdf/filters';
import { defaultLayout, type LayoutSettings } from './pdf/layout-settings';

const LS_KEY = 'printifier.presets.v1';
export const MAX_PRESETS = 24;

export interface Preset {
  id: string;
  name: string;
  /** i18n key — when set, `name` is ignored and t(nameKey) is rendered. */
  nameKey?: string;
  /** Built-ins ship with the app and cannot be deleted. */
  builtin?: boolean;
  ts: number;
  filters: FilterSettings;
  layout: LayoutSettings;
}

/**
 * Built-in recipes — the answer to "which settings should I pick?".
 * Economy squeezes the most out of every sheet, Balanced is the everyday
 * default, Exam-cram trades some ink for readability.
 */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'builtin:economy',
    name: 'Economy',
    nameKey: 'pr.builtin.economy',
    builtin: true,
    ts: 0,
    filters: {
      colorMode: 'bw',
      inkSaver: 65,
      cleanStains: true,
      trimMargins: true,
      penBoost: 0,
      searchable: false,
    },
    layout: {
      pageSize: 'a4',
      orientation: 'portrait',
      rows: 3,
      cols: 2,
      separators: true,
      pageNumbers: true,
      quality: 'low',
      booklet: false,
      duplexPad: false,
    },
  },
  {
    id: 'builtin:balanced',
    name: 'Balanced',
    nameKey: 'pr.builtin.balanced',
    builtin: true,
    ts: 0,
    filters: {
      colorMode: 'auto',
      inkSaver: 45,
      cleanStains: true,
      trimMargins: false,
      penBoost: 0,
      searchable: false,
    },
    layout: {
      pageSize: 'a4',
      orientation: 'portrait',
      rows: 2,
      cols: 2,
      separators: true,
      pageNumbers: true,
      quality: 'medium',
      booklet: false,
      duplexPad: false,
    },
  },
  {
    id: 'builtin:exam-cram',
    name: 'Exam cram',
    nameKey: 'pr.builtin.exam',
    builtin: true,
    ts: 0,
    filters: {
      colorMode: 'original',
      inkSaver: 55,
      cleanStains: true,
      trimMargins: true,
      penBoost: 20,
      searchable: false,
    },
    layout: {
      pageSize: 'a4',
      orientation: 'portrait',
      rows: 2,
      cols: 1,
      separators: true,
      pageNumbers: true,
      quality: 'high',
      booklet: false,
      duplexPad: false,
    },
  },
];

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPresets(): Preset[] {
  const s = ls();
  if (!s) return [];
  try {
    const raw = s.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Preset[];
    if (!Array.isArray(parsed)) return [];
    // migrate old snapshots: fill fields added later with defaults
    return parsed
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({
        ...p,
        filters: { ...defaultFilters, ...(p.filters ?? {}) },
        layout: { ...defaultLayout, ...(p.layout ?? {}) },
      }));
  } catch {
    return [];
  }
}

/** Built-ins first, then the user's own — the full list shown in the UI. */
export function allPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...loadPresets()];
}

export function savePresetsToDisk(presets: Preset[]): void {
  const s = ls();
  if (!s) return;
  try {
    s.setItem(LS_KEY, JSON.stringify(presets));
  } catch {
    // quota — non-fatal
  }
}

export function makePresetId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Sharing — export/import presets as a small JSON file so classmates can
// swap "recipes" (chat apps, pen drives, anything). Still 100% offline.
// ---------------------------------------------------------------------------

/** Serialize presets into a portable JSON string. */
export function serializePresets(presets: Preset[]): string {
  return JSON.stringify(
    {
      app: 'notes-printifier',
      kind: 'presets',
      v: 1,
      exportedAt: new Date().toISOString(),
      presets,
    },
    null,
    2,
  );
}

/**
 * Parse an imported preset file and merge it into the stored list.
 * Returns how many presets were imported (0 when the file is invalid).
 * Incoming names that collide with existing ones get a " (2)" suffix.
 */
export function mergeImportedPresets(text: string): number {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 0;
  }
  const container = data as { presets?: unknown } | null;
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(container?.presets)
      ? container.presets
      : [];
  if (raw.length === 0 || raw.length > 200) return 0;

  const incoming: Preset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return 0; // reject malformed files outright
    const p = item as Partial<Preset>;
    if (typeof p.name !== 'string') return 0;
    incoming.push({
      id: typeof p.id === 'string' && p.id ? p.id : makePresetId(),
      name: p.name.slice(0, 40).trim() || 'Imported',
      ts: typeof p.ts === 'number' ? p.ts : Date.now(),
      filters: { ...defaultFilters, ...(p.filters ?? {}) },
      layout: { ...defaultLayout, ...(p.layout ?? {}) },
    });
  }

  const existing = loadPresets();
  const names = new Set(existing.map((p) => p.name));
  for (const p of incoming) {
    if (names.has(p.name)) p.name = `${p.name} (2)`.slice(0, 40);
    names.add(p.name);
  }

  const merged = [...incoming, ...existing].slice(0, MAX_PRESETS);
  savePresetsToDisk(merged);
  return incoming.length;
}
