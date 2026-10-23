/**
 * theme.ts — 18 selectable themes + 10 backdrop patterns + look & feel
 * customisation (density, corners, motion, confetti, wheel sensitivity).
 *
 * A theme is an id that maps to CSS custom-property blocks in globals.css
 * (`html[data-theme='…']`). Light themes additionally keep the legacy
 * `theme-light` class on <html> so the existing paper-glass remaps fire.
 * The backdrop pattern is exposed as a `data-pattern` attribute that the
 * DYNAMIC BACKGROUND section of globals.css uses to restyle `.dyn-gridlayer`.
 *
 * Customisation flags ride along as more data-attributes:
 *   data-density='compact' → smaller root font (everything scales down)
 *   data-corners='sharp'   → zero border-radius everywhere (photocopy vibe)
 *   data-motion='calm'     → kill animations (MotionConfig + CSS fallback)
 *   confetti → fires the celebration canvas when a job finishes
 *   wheel    → mouse-wheel damping strength (0 = native, 80 = very slow)
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
  | 'mint'
  | 'blueprint'
  | 'kraft'
  | 'chai'
  | 'festive'
  | 'xerox'
  | 'ohp';

/** UI density — scales the whole interface via the root font size. */
export type Density = 'comfy' | 'compact';
/** Corner style — soft rounded, or 90° photocopy-sharp. */
export type Corners = 'round' | 'sharp';
/** Motion level — full animation, or a calm reduced-motion mode. */
export type MotionPref = 'full' | 'calm';

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
  // — unique additions (print-shop heritage themes) —
  { id: 'blueprint', light: false, swatch: ['#061019', '#0a1a29', '#38bdf8'] },
  { id: 'kraft', light: true, swatch: ['#f1e7d3', '#faf3e6', '#a1662f'] },
  { id: 'chai', light: true, swatch: ['#f8f0e0', '#fffbf0', '#c98a2e'] },
  { id: 'festive', light: false, swatch: ['#14061a', '#20092b', '#f59e0b'] },
  { id: 'xerox', light: true, swatch: ['#f4f4f3', '#ffffff', '#171717'] },
  { id: 'ohp', light: false, swatch: ['#151009', '#221a10', '#fbbf24'] },
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

function applyDensity(d: Density) {
  try {
    document.documentElement.dataset.density = d;
  } catch {
    // non-DOM context — ignore
  }
}

function applyCorners(c: Corners) {
  try {
    document.documentElement.dataset.corners = c;
  } catch {
    // non-DOM context — ignore
  }
}

function applyMotion(m: MotionPref) {
  try {
    document.documentElement.dataset.motion = m;
  } catch {
    // non-DOM context — ignore
  }
}

/** Clamp for the wheel-damping slider (0–80 %). */
export const WHEEL_MIN = 0;
export const WHEEL_MAX = 80;
export const WHEEL_DEFAULT = 45;

function clampWheel(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : WHEEL_DEFAULT;
  return Math.min(WHEEL_MAX, Math.max(WHEEL_MIN, Math.round(n)));
}

interface ThemeState {
  themeId: ThemeId;
  pattern: PatternId;
  /** last dark / light theme — used by the quick light/dark flip */
  lastDark: ThemeId;
  lastLight: ThemeId;
  /** Look & feel customisation (Theme Workshop). */
  density: Density;
  corners: Corners;
  motion: MotionPref;
  /** Celebrate a finished job with a confetti burst. */
  confetti: boolean;
  /** Mouse-wheel damping strength in % (0 = native scroll speed). */
  wheel: number;
  setTheme: (id: ThemeId) => void;
  setPattern: (p: PatternId) => void;
  setDensity: (d: Density) => void;
  setCorners: (c: Corners) => void;
  setMotion: (m: MotionPref) => void;
  setConfetti: (on: boolean) => void;
  setWheel: (v: number) => void;
  /** Temporarily paint a theme's look (CSS attribute only) WITHOUT changing
   *  the committed choice or persisting anything — powers the welcome-tour
   *  live hover preview. Pass null to restore the committed theme. */
  preview: (id: ThemeId | null) => void;
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
  density: Density;
  corners: Corners;
  motion: MotionPref;
  confetti: boolean;
  wheel: number;
}

function persist(s: ThemeState) {
  try {
    const blob: Persist = {
      id: s.themeId,
      pattern: s.pattern,
      lastDark: s.lastDark,
      lastLight: s.lastLight,
      density: s.density,
      corners: s.corners,
      motion: s.motion,
      confetti: s.confetti,
      wheel: s.wheel,
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
  density: 'comfy',
  corners: 'round',
  motion: 'full',
  confetti: true,
  wheel: WHEEL_DEFAULT,

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

  setDensity: (d) => {
    applyDensity(d);
    set({ density: d });
    persist(get());
  },

  setCorners: (c) => {
    applyCorners(c);
    set({ corners: c });
    persist(get());
  },

  setMotion: (m) => {
    applyMotion(m);
    set({ motion: m });
    persist(get());
  },

  setConfetti: (on) => {
    set({ confetti: on });
    persist(get());
  },

  setWheel: (v) => {
    set({ wheel: clampWheel(v) });
    persist(get());
  },

  preview: (id) => {
    applyTheme(id ?? get().themeId);
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
        const density: Density = p.density === 'compact' ? 'compact' : 'comfy';
        const corners: Corners = p.corners === 'sharp' ? 'sharp' : 'round';
        const motion: MotionPref = p.motion === 'calm' ? 'calm' : 'full';
        const confetti = typeof p.confetti === 'boolean' ? p.confetti : true;
        applyTheme(id);
        applyPattern(pattern);
        applyDensity(density);
        applyCorners(corners);
        applyMotion(motion);
        set({
          themeId: id,
          pattern,
          density,
          corners,
          motion,
          confetti,
          wheel: clampWheel(p.wheel),
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
