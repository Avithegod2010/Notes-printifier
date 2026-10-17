/**
 * theme.ts — 12 selectable themes + 10 backdrop patterns.
 *
 * A theme is an id that maps to CSS custom-property blocks in globals.css
 * (`html[data-theme='…']`). Light themes additionally keep the legacy
 * `theme-light` class on <html> so the existing paper-glass remaps fire.
 * The backdrop pattern is exposed as a `data-pattern` attribute that the
 * DYNAMIC BACKGROUND section of globals.css uses to restyle `.dyn-gridlayer`.
 *
 * Everything is applied client-side post-hydration: SSR always renders the
 * default "Midnight Violet" dark look, so there is never a hydration
 * mismatch.
 */

import { create } from 'zustand';

export type ThemeId =
  | 'violet'
  | 'paper'
  | 'cyber'
  | 'matrix'
  | 'ember'
  | 'rose'
  | 'crimson'
  | 'ocean'
  | 'nord'
  | 'noir'
  | 'sand'
  | 'mint';

export type PatternId =
  | 'grid'
  | 'dots'
  | 'hex'
  | 'weave'
  | 'topo'
  | 'circuit'
  | 'waves'
  | 'diag'
  | 'plus'
  | 'none';

interface ThemeMeta {
  id: ThemeId;
  light: boolean;
  /** three dots shown in the picker: page bg, surface, accent */
  swatch: [string, string, string];
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'violet', light: false, swatch: ['#0b0a10', '#15121c', '#8b5cf6'] },
  { id: 'paper', light: true, swatch: ['#f4f2f8', '#ffffff', '#7c3aed'] },
  { id: 'cyber', light: false, swatch: ['#05080d', '#0a141c', '#22d3ee'] },
  { id: 'matrix', light: false, swatch: ['#030907', '#081511', '#34d399'] },
  { id: 'ember', light: false, swatch: ['#0c0703', '#160e07', '#f59e0b'] },
  { id: 'rose', light: true, swatch: ['#fdf5f8', '#ffffff', '#db2777'] },
  { id: 'crimson', light: false, swatch: ['#0d0507', '#180a0e', '#f43f5e'] },
  { id: 'ocean', light: false, swatch: ['#030b14', '#081725', '#38bdf8'] },
  { id: 'nord', light: false, swatch: ['#0c1116', '#12181f', '#88c0d0'] },
  { id: 'noir', light: false, swatch: ['#060607', '#101012', '#e4e4e7'] },
  { id: 'sand', light: true, swatch: ['#faf6ee', '#ffffff', '#b45309'] },
  { id: 'mint', light: true, swatch: ['#f2faf5', '#ffffff', '#059669'] },
];

export const PATTERNS: readonly PatternId[] = [
  'grid',
  'dots',
  'hex',
  'weave',
  'topo',
  'circuit',
  'waves',
  'diag',
  'plus',
  'none',
];

export const isLightTheme = (id: ThemeId): boolean =>
  THEMES.find((t) => t.id === id)?.light ?? false;

const THEME_IDS = THEMES.map((t) => t.id);
const PATTERN_IDS = PATTERNS;

const LS_NEW = 'printifier.theme2';
const LS_LEGACY = 'printifier.theme';

function applyTheme(id: ThemeId) {
  try {
    const root = document.documentElement;
    root.dataset.theme = id;
    root.classList.toggle('theme-light', isLightTheme(id));
  } catch {
    // non-DOM context — ignore
  }
}

function applyPattern(p: PatternId) {
  try {
    document.documentElement.dataset.pattern = p;
  } catch {
    // non-DOM context — ignore
  }
}

interface ThemeState {
  themeId: ThemeId;
  pattern: PatternId;
  /** last dark / light theme — used by the quick light/dark flip */
  lastDark: ThemeId;
  lastLight: ThemeId;
  setTheme: (id: ThemeId) => void;
  setPattern: (p: PatternId) => void;
  /** Flip between the last dark and last light theme (quick toggle). */
  flip: () => void;
  /** Restore persisted choices (mount-time, client only). */
  hydrate: () => void;
}

interface Persist {
  id: ThemeId;
  pattern: PatternId;
  lastDark: ThemeId;
  lastLight: ThemeId;
}

function persist(s: Pick<ThemeState, 'themeId' | 'pattern' | 'lastDark' | 'lastLight'>) {
  try {
    const blob: Persist = {
      id: s.themeId,
      pattern: s.pattern,
      lastDark: s.lastDark,
      lastLight: s.lastLight,
    };
    window.localStorage.setItem(LS_NEW, JSON.stringify(blob));
  } catch {
    // storage unavailable — session-only theme
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: 'violet',
  pattern: 'grid',
  lastDark: 'violet',
  lastLight: 'paper',

  setTheme: (id) => {
    if (!THEME_IDS.includes(id)) return;
    applyTheme(id);
    const patch: Partial<ThemeState> = { themeId: id };
    if (isLightTheme(id)) patch.lastLight = id;
    else patch.lastDark = id;
    set(patch as ThemeState);
    persist({ ...get(), ...patch } as ThemeState);
  },

  setPattern: (p) => {
    if (!PATTERN_IDS.includes(p)) return;
    applyPattern(p);
    set({ pattern: p });
    persist(get());
  },

  flip: () => {
    const cur = get().themeId;
    const next = isLightTheme(cur) ? get().lastDark : get().lastLight;
    get().setTheme(next);
  },

  hydrate: () => {
    try {
      const raw = window.localStorage.getItem(LS_NEW);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persist>;
        const id = p.id && THEME_IDS.includes(p.id) ? p.id : 'violet';
        const pattern = p.pattern && PATTERN_IDS.includes(p.pattern) ? p.pattern : 'grid';
        applyTheme(id);
        applyPattern(pattern);
        set({
          themeId: id,
          pattern,
          lastDark: p.lastDark && THEME_IDS.includes(p.lastDark) ? p.lastDark : 'violet',
          lastLight: p.lastLight && THEME_IDS.includes(p.lastLight) ? p.lastLight : 'paper',
        });
        return;
      }
      // legacy migration: old 'dark' | 'light' key
      const legacy = window.localStorage.getItem(LS_LEGACY);
      if (legacy === 'light') {
        applyTheme('paper');
        applyPattern('grid');
        set({ themeId: 'paper' });
      }
    } catch {
      // storage unavailable — stay default
    }
  },
}));
