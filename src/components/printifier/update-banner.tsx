'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PartyPopper, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_VERSION, isNewerVersion } from '@/lib/version';
import { useT } from '@/lib/i18n';

/**
 * Update prompt (#10 + v2.0 rework). On idle it fetches /version.json
 * (cache-busted) and compares against the running APP_VERSION. When the
 * running copy is behind the deployed one the user gets a centered POPUP
 * (not a subtle corner banner) with an "Update now" button that clears
 * every app cache and reloads — so PWA users who received the old shell
 * from the service-worker cache land on the fresh version immediately.
 *
 * On the website a newer manifest means a new deploy → prompt. Inside the
 * Android APK the manifest ships with the app itself, so versions always
 * match and the popup stays silent (no false positives offline).
 *
 * Dismissal ("Later") is keyed to the REMOTE version, so a subsequent
 * release prompts again instead of staying silent forever.
 */
export function UpdateBanner() {
  const t = useT();
  const [remote, setRemote] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const check = () => {
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/version.json?_=${Date.now()}`, {
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { version?: string } | null) => {
          if (cancelled) return;
          const v = data?.version;
          if (!v || !isNewerVersion(v, APP_VERSION)) return;
          // A previously dismissed version never re-prompts…
          try {
            if (window.sessionStorage.getItem('printifier.updateDismissed') === v) return;
          } catch {
            // private mode — always prompt
          }
          setRemote((prev) => prev ?? v);
        })
        .catch(() => undefined);
    };
    // first check shortly after load, then every 10 minutes and whenever the
    // tab becomes visible again — catches deploys made mid-session.
    const t1 = setTimeout(check, 4000);
    const iv = setInterval(check, 10 * 60 * 1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem('printifier.updateDismissed', remote ?? APP_VERSION);
    } catch {
      // private mode
    }
    setRemote(null);
  };

  /** Drop every app cache so the reload can only land on fresh assets. */
  const updateNow = async () => {
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith('printifier-'))
            .map((k) => caches.delete(k)),
        );
      }
    } catch {
      // Cache API unavailable — the reload alone still fetches the new shell
      // (navigations are network-first).
    }
    window.location.reload();
  };

  return (
    <AnimatePresence>
      {remote && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={t('upd.title', { v: remote })}
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 32, scale: 0.96 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="relative w-full max-w-sm rounded-2xl border border-violet-400/40 bg-[var(--header-bg)] p-6 text-center shadow-2xl shadow-black/60"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('upd.later')}
              onClick={dismiss}
              className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>

            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
              <PartyPopper className="h-7 w-7 text-white" aria-hidden="true" />
            </span>

            <p className="text-base font-bold">{t('upd.title', { v: remote })}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {t('upd.body')}
            </p>

            <Button
              type="button"
              size="lg"
              onClick={() => void updateNow()}
              className="mt-5 h-12 w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-base text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              <RefreshCw className="mr-2 h-5 w-5" /> {t('upd.reload')}
            </Button>
            <button
              type="button"
              onClick={dismiss}
              className="mt-2.5 w-full rounded-md py-2 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t('upd.later')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
