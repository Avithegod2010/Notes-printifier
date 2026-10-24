'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PartyPopper, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_VERSION, isNewerVersion } from '@/lib/version';
import { useT } from '@/lib/i18n';

/**
 * Update checker (#10). On idle it fetches /version.json (cache-busted) and
 * compares against the running APP_VERSION. On the website a newer manifest
 * means a new deploy → offer a refresh. Inside the Android APK the manifest
 * ships with the app itself, so versions always match and the banner stays
 * silent (no false positives offline).
 */
export function UpdateBanner() {
  const t = useT();
  const [remote, setRemote] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem('printifier.updateDismissed') === APP_VERSION) return;
    const t1 = setTimeout(() => {
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/version.json?_=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { version?: string } | null) => {
          const v = data?.version;
          if (v && isNewerVersion(v, APP_VERSION)) setRemote(v);
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearTimeout(t1);
  }, []);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem('printifier.updateDismissed', APP_VERSION);
    } catch {
      // private mode
    }
    setRemote(null);
  };

  return (
    <AnimatePresence>
      {remote && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25 }}
          role="status"
          className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-violet-400/40 bg-[var(--header-bg)] p-3 shadow-2xl shadow-black/50 backdrop-blur-md sm:inset-x-auto sm:right-[calc(1.25rem+env(safe-area-inset-right))]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600">
            <PartyPopper className="h-4.5 w-4.5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{t('upd.title', { v: remote })}</p>
            <p className="text-xs text-muted-foreground">{t('upd.body')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => window.location.reload()}
            className="shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t('upd.reload')}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('upd.later')}
            onClick={dismiss}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
