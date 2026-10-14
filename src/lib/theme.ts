/**
 * theme.ts — light/dark theme toggle.
 *
 * The app is dark by default (a violet-tinted near-black). Choosing "light"
 * adds the `theme-light` class to <html>; globals.css then remaps the shadcn
 * tokens and the hardcoded glass utilities to a warm paper look. The choice
 * is persisted in localStorage and restored post-hydration, so SSR always
 * renders dark and there is never a hydration mismatch.
 */

import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const LS_KEY = 'printifier.theme';

function applyTheme(theme: Theme) {
  try {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  } catch {
    // non-DOM context — ignore
  }
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  /** Restore the persisted choice (mount-time, client only). */
  hydrate: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'dark',
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
    } catch {
      // storage unavailable — session-only theme
    }
    set({ theme: next });
  },
  hydrate: () => {
    try {
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved === 'light' || saved === 'dark') {
        applyTheme(saved);
        set({ theme: saved });
      }
    } catch {
      // storage unavailable — stay dark
    }
  },
}));
