'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APP_VERSION } from '@/lib/version';
import { useLangStore, useT } from '@/lib/i18n';

interface VersionManifest {
  version: string;
  updated: string;
  notes: string[];
  /** Hindi release notes (falls back to `notes` for other languages). */
  notes_hi?: string[];
}

const RELEASES_URL = 'https://github.com/Avithegod2010/Notes-printifier/releases';

/**
 * In-app version history viewer (#7-f). The footer's version badge opens a
 * dialog that fetches the LIVE /version.json (cache-busted — same file the
 * update banner polls) and renders the deployed release notes, so users can
 * see what's new without leaving the app. Works fully on GitHub Pages
 * (static file) and degrades gracefully when offline.
 */
export function VersionBadge() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/version.json?_=${Date.now()}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as VersionManifest;
      if (!data || typeof data.version !== 'string' || !Array.isArray(data.notes)) {
        throw new Error('bad-manifest');
      }
      setManifest(data);
    } catch {
      setFailed(true);
      setManifest(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // defer: load() sets loading state synchronously — schedule it so the
    // effect body itself never calls setState (react-hooks/set-state-in-effect)
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [open, load]);

  const isLatest =
    manifest !== null && manifest.version.replace(/^v/, '') === APP_VERSION.replace(/^v/, '');

  // Hindi users get the हिन्दी notes when the deployed manifest ships them.
  const shownNotes =
    manifest === null
      ? []
      : lang === 'hi' && manifest.notes_hi && manifest.notes_hi.length > 0
        ? manifest.notes_hi
        : manifest.notes;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-label={t('vh.title')}
        title={t('vh.title')}
        onClick={() => setOpen(true)}
        className="h-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
      >
        <History className="mr-1 h-3 w-3" aria-hidden="true" />
        v{APP_VERSION}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-2xl border-white/10 bg-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-left">
              <Rocket className="h-4 w-4 text-violet-300" aria-hidden="true" />
              {t('vh.title')}
            </DialogTitle>
            <DialogDescription className="text-left">{t('vh.sub')}</DialogDescription>
          </DialogHeader>

          <div className="pretty-scroll max-h-72 overflow-y-auto pr-1">
            {loading && (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('vh.loading')}
              </p>
            )}

            {!loading && failed && (
              <div className="space-y-3 py-2">
                <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm">
                  <span className="font-mono text-xs text-violet-200">v{APP_VERSION}</span>{' '}
                  <span className="text-muted-foreground">· {t('vh.running')}</span>
                </p>
                <p className="text-xs text-muted-foreground">{t('vh.fail')}</p>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-semibold text-violet-300 underline-offset-2 hover:underline"
                >
                  {t('vh.releases')}
                </a>
              </div>
            )}

            {!loading && manifest && (
              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 font-mono text-xs text-violet-200">
                    v{manifest.version}
                  </span>
                  <span className="text-xs text-muted-foreground">{manifest.updated}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isLatest
                        ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                        : 'border border-white/15 bg-white/5 text-muted-foreground'
                    }`}
                  >
                    {isLatest ? t('vh.latest') : t('vh.running')}
                  </span>
                </p>
                <ul className="space-y-2">
                  {shownNotes.map((note, i) => (
                    <li
                      key={i}
                      className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-hidden="true" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-semibold text-violet-300 underline-offset-2 hover:underline"
                >
                  {t('vh.releases')}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
