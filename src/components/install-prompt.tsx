'use client';

/**
 * install-prompt.ts — "Install app" button for the PWA.
 *
 * Chromium fires `beforeinstallprompt` when the site meets install criteria
 * (HTTPS + manifest + service worker). We capture it at module scope — the
 * event can fire BEFORE React hydrates — and expose a small subscribe API so
 * the button re-renders the moment it becomes available. The button hides
 * itself once the app is installed (display-mode: standalone) or after the
 * user accepts/dismisses the native dialog.
 *
 * iOS Safari has no beforeinstallprompt; there the button simply never
 * appears (users install via Share → Add to Home Screen).
 */

import { useSyncExternalStore } from 'react';
import { MonitorDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let alreadyInstalled =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari standalone flag
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    alreadyInstalled = true;
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function canInstall(): boolean {
  return !alreadyInstalled && deferred !== null;
}

/** Show the native install dialog. No-op when nothing is pending. */
function requestInstall(): void {
  void deferred?.prompt().then(() => {
    // the beforeinstallprompt event is single-use — drop it after prompting
    deferred = null;
    emit();
  });
}

/** Header install button — renders nothing until the browser allows install. */
export function InstallButton() {
  const t = useT();
  const available = useSyncExternalStore(subscribe, canInstall, () => false);
  if (!available) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={requestInstall}
      aria-label={t('nav.install')}
      title={t('nav.install')}
      className="hidden h-9 border-violet-400/40 bg-violet-500/10 px-3 text-sm font-semibold text-violet-200 hover:bg-violet-500/20 hover:text-violet-100 sm:inline-flex"
    >
      <MonitorDown className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline">{t('nav.install')}</span>
    </Button>
  );
}

/** Kept for future mobile-menu placement. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, canInstall, () => false);
}
