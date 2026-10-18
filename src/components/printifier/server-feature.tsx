'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, CloudCog, ServerOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

/**
 * ServerFeatureDialog — "this one needs the server" explainer.
 *
 * Static deployments (GitHub Pages and the offline Android APK) ship no
 * backend, so the server-powered features (AI print doctor, voice commands,
 * spoken receipt, cloud preset links & QR, cloud import, community stats)
 * stay VISIBLE but open this dialog instead of firing doomed requests.
 *
 * Usage: call showServerFeature(<label>) from anywhere; mount <ServerFeatureDialog />
 * once near the app root. `HAS_SERVER_API` stays the compile-time switch —
 * on a real deployment (dev server / standalone / Vercel) the features run
 * normally and this dialog is never shown.
 */

export interface ServerFeatureInfo {
  /** Display name of the feature, already localized by the caller. */
  label: string;
}

type Listener = (info: ServerFeatureInfo | null) => void;

const listeners = new Set<Listener>();

/** Open the "needs the server" dialog for a feature. */
export function showServerFeature(label: string) {
  const info = { label };
  listeners.forEach((l) => l(info));
}

export function ServerFeatureDialog() {
  const t = useT();
  const [info, setInfo] = useState<ServerFeatureInfo | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    const l: Listener = (i) => {
      setInfo(i);
      setWhyOpen(false);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <Dialog
      open={info !== null}
      onOpenChange={(v) => {
        if (!v) setInfo(null);
      }}
    >
      <DialogContent className="max-w-md rounded-2xl border-white/10 bg-zinc-950/95 text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CloudCog className="h-5 w-5 shrink-0 text-violet-300" aria-hidden="true" />
            {info ? t('sf.title', { f: info.label }) : ''}
          </DialogTitle>
          <DialogDescription className="pt-1 text-sm leading-relaxed text-muted-foreground">
            {t('sf.body')}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-white/10 bg-white/[0.03]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold"
            onClick={() => setWhyOpen((v) => !v)}
            aria-expanded={whyOpen}
          >
            <span className="flex items-center gap-2">
              <ServerOff className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
              {t('sf.whyBtn')}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${whyOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {whyOpen && (
            <div className="space-y-2.5 border-t border-white/10 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              <p>{t('sf.whyHosting')}</p>
              <p>
                <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                {t('sf.whyWorks')}
              </p>
              <p>{t('sf.howToGet')}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            onClick={() => setInfo(null)}
            className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
          >
            {t('sf.ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
