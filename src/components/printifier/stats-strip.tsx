'use client';

import { useEffect, useState } from 'react';
import { FileCheck2, Layers, Leaf, PiggyBank } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { HAS_SERVER_API } from '@/lib/server-api';
import { showServerFeature } from '@/components/printifier/server-feature';

interface Stats {
  totalFiles: number;
  totalInputPages: number;
  totalOutputPages: number;
  avgInkSavedPct: number;
}

export function StatsStrip() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const needsServer = !HAS_SERVER_API;

  useEffect(() => {
    // Static build (GitHub Pages / APK): no community stats endpoint — the
    // tiles stay visible and explain themselves on tap instead.
    if (!HAS_SERVER_API) return;
    let cancelled = false;
    fetch('/api/prints')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((data: Stats) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const paperSavedPct =
    stats && stats.totalInputPages > 0
      ? Math.max(0, Math.round((1 - stats.totalOutputPages / stats.totalInputPages) * 100))
      : null;

  // Rough ₹ estimate: ~₹1 per sheet of paper saved + ink saved by the
  // enhancement step. Ink part assumes ~0.9 pages worth of ink per input
  // page at ~₹1.3/page full-ink cost, scaled by the average ink-saved %.
  const paperSaved =
    stats !== null ? Math.max(0, stats.totalInputPages - stats.totalOutputPages) : 0;
  const avgInkSavedPct = stats?.avgInkSavedPct ?? 0;
  const inkPart = stats
    ? Math.round(stats.totalInputPages * 0.9 * 1.3 * (avgInkSavedPct / 100))
    : 0;
  const rupees = stats ? Math.max(0, paperSaved * 1 + inkPart) : 0;

  const items = [
    {
      icon: FileCheck2,
      value: stats ? stats.totalFiles.toLocaleString() : '—',
      label: t('st.files'),
    },
    {
      icon: Layers,
      value: stats ? stats.totalInputPages.toLocaleString() : '—',
      label: t('st.pagesCompacted'),
    },
    {
      icon: Leaf,
      value: paperSavedPct !== null ? `${paperSavedPct}%` : '—',
      label: t('st.paper'),
    },
    {
      icon: PiggyBank,
      value: stats ? `≈ ₹${rupees.toLocaleString('en-IN')}` : '—',
      label: t('st.money'),
    },
  ];

  const tap = () => showServerFeature(t('sf.feature.stats'));

  return (
    <section aria-label="Community impact" className="mx-auto max-w-3xl px-4 py-14">
      <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            role={needsServer ? 'button' : undefined}
            tabIndex={needsServer ? 0 : undefined}
            onKeyDown={
              needsServer
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') tap();
                  }
                : undefined
            }
            onClick={needsServer ? tap : undefined}
            aria-label={needsServer ? `${item.label} — ${t('sf.whyBtn')}` : undefined}
            className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center transition-colors sm:p-6 ${
              needsServer ? 'cursor-pointer hover:border-fuchsia-400/40 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60' : ''
            }`}
          >
            <item.icon className="mx-auto mb-2 h-5 w-5 text-violet-400" aria-hidden="true" />
            <p className="whitespace-nowrap text-2xl font-extrabold tracking-tight sm:text-3xl">
              {item.value}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground sm:text-xs">
              {item.label}
            </p>
            {needsServer && (
              <p className="mt-1.5 text-[10px] font-medium text-fuchsia-300/80">
                {t('sf.whyBtn')}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t('st.note')}
      </p>
    </section>
  );
}
