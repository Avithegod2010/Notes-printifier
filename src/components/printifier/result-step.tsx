'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  Flame,
  ImageDown,
  IndianRupee,
  Loader2,
  MessageCircle,
  Pencil,
  Printer,
  RotateCcw,
  ScanText,
  Scissors,
  Smartphone,
  Type,
  Leaf,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePrintifyStore } from '@/lib/printify-store';
import { type ColorMode } from '@/lib/pdf/filters';
import {
  costProfileIsDefault,
  estimateSavings,
  formatRupees,
  loadCostProfile,
  saveCostProfile,
  DEFAULT_COST,
  type CostProfile,
} from '@/lib/savings';
import {
  co2GramsFor,
  computeStreak,
  loadInkStats,
  loadJobLog,
  milestoneFor,
  resetInkStats,
  treesFor,
  type InkStats,
} from '@/lib/ink-stats';
import { listRecentJobs, downloadBlob, type RecentJob } from '@/lib/recent-jobs';
import { buildReceiptCanvas, receiptCanvasToBlob } from '@/lib/receipt';
import { ListenButton } from './listen-button';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

/**
 * Telegram brand mark — lucide has no brand icons, so inline the classic
 * paper-plane-in-circle path (simple-icons) and tint via currentColor.
 */
function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** colorMode → i18n key, so the result stat shows the mode in the active language. */
const MODE_I18N_KEY: Record<ColorMode, string> = {
  auto: 'en.mode.auto',
  invert: 'en.mode.invert',
  original: 'en.mode.original',
  grayscale: 'en.mode.grayscale',
  bw: 'en.mode.bw',
};

export function ResultStep() {
  const t = useT();
  const result = usePrintifyStore((s) => s.result);
  const filters = usePrintifyStore((s) => s.filters);
  const layout = usePrintifyStore((s) => s.layout);
  const reset = usePrintifyStore((s) => s.reset);

  // iOS Safari cannot render PDFs inside iframes — show a friendly fallback.
  const [iosLike, setIosLike] = useState(false);
  useEffect(() => {
    // Deferred so the first client render matches SSR (iframe shown), then we
    // swap in the fallback once we can inspect the real user agent.
    const t = setTimeout(() => {
      const ua = navigator.userAgent;
      setIosLike(
        /iPad|iPhone|iPod/.test(ua) ||
          (ua.includes('Macintosh') && navigator.maxTouchPoints > 1),
      );
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Duplex helper — split the output into odd / even sheet files.
  const [splitting, setSplitting] = useState(false);
  const [duplex, setDuplex] = useState<{
    oddUrl: string;
    evenUrl: string;
    oddCount: number;
    evenCount: number;
  } | null>(null);

  const makeDuplexFiles = async () => {
    if (!result || splitting) return;
    setSplitting(true);
    try {
      // pdf-lib loads on demand — keeps it out of the initial JS bundle.
      const { PDFDocument } = await import('pdf-lib');
      const buf = await fetch(result.url).then((r) => r.arrayBuffer());
      const src = await PDFDocument.load(buf);
      const n = src.getPageCount();
      const oddIdx: number[] = [];
      const evenIdx: number[] = [];
      for (let i = 0; i < n; i++) (i % 2 === 0 ? oddIdx : evenIdx).push(i);

      const build = async (idx: number[]) => {
        const doc = await PDFDocument.create();
        if (idx.length) {
          const copied = await doc.copyPages(src, idx);
          copied.forEach((p) => doc.addPage(p));
        }
        const bytes = await doc.save();
        return URL.createObjectURL(
          new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        );
      };
      const [oddUrl, evenUrl] = await Promise.all([build(oddIdx), build(evenIdx)]);
      setDuplex({ oddUrl, evenUrl, oddCount: oddIdx.length, evenCount: evenIdx.length });
    } catch (err) {
      console.error('Duplex split failed', err);
    } finally {
      setSplitting(false);
    }
  };

  useEffect(
    () => () => {
      if (duplex) {
        URL.revokeObjectURL(duplex.oddUrl);
        URL.revokeObjectURL(duplex.evenUrl);
      }
    },
    [duplex],
  );

  // ---- shareable ink-savings receipt (PNG card) ----------------------------
  const [receiptBusy, setReceiptBusy] = useState(false);
  const makeReceipt = async () => {
    if (!result || receiptBusy) return;
    setReceiptBusy(true);
    try {
      const canvas = buildReceiptCanvas(
        {
          inputPages: result.inputPages,
          outputPages: result.outputPages,
          inkSavedPct: result.inkSavedPct,
          paperSavedPct: paperSavedPct,
          rupees: savings.rupees > 0 ? formatRupees(savings.rupees) : '₹0',
          fileSize: formatMB(result.outputBytes),
          badgeText: receiptBadge,
        },
        {
          title: 'Notes Printifier',
          subtitle: t('rs.receipt.sub'),
          inkSaved: t('rs.inkSaved'),
          pagesIn: t('rs.receipt.pagesIn'),
          paperSaved: t('ly.paperSaved'),
          moneySaved: t('rs.receipt.money'),
          fileSize: t('rs.size'),
          footnote: t('rs.receipt.footnote'),
        },
      );
      const blob = await receiptCanvasToBlob(canvas);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      let shared = false;
      if (typeof nav.share === 'function' && nav.canShare) {
        try {
          const file = new File([blob], 'printifier-receipt.png', { type: 'image/png' });
          if (nav.canShare({ files: [file] })) {
            await nav.share({
              files: [file],
              title: 'Notes Printifier',
            });
            shared = true;
            toast({ description: t('rs.receipt.shared') });
          }
        } catch (shareErr) {
          // user cancelled the share sheet — not an error, just save instead
          if (!(shareErr instanceof DOMException && shareErr.name === 'AbortError')) {
            console.debug('Web Share failed, falling back to download', shareErr);
          } else {
            setReceiptBusy(false);
            return;
          }
        }
      }
      if (!shared) {
        downloadBlob(blob, 'printifier-receipt.png');
        toast({ description: t('rs.receipt.saved') });
      }
    } catch (err) {
      console.error('Receipt build failed', err);
      toast({ description: t('rs.receipt.fail') });
    } finally {
      setReceiptBusy(false);
    }
  };

  // ---- personal savings history (local, on-device) -------------------------
  const [history, setHistory] = useState<RecentJob[] | null>(null);
  const [impact, setImpact] = useState<InkStats | null>(null);
  useEffect(() => {
    let dead = false;
    void listRecentJobs().then((jobs) => {
      if (!dead) setHistory(jobs.slice(0, 8)); // newest first
    });
    return () => {
      dead = true;
    };
  }, []);

  // Lifetime impact meter — refreshed after every result mounts.
  useEffect(() => {
    setImpact(loadInkStats().jobs > 0 ? loadInkStats() : null);
  }, []);

  // F5 — print cost profile (₹/sheet, ₹/full-ink page)
  const [profile, setProfile] = useState<CostProfile>(() => loadCostProfile());
  const [costOpen, setCostOpen] = useState(false);
  const [costPaper, setCostPaper] = useState('1');
  const [costInk, setCostInk] = useState('1.3');
  const openCostDialog = () => {
    setCostPaper(String(profile.paperRsPerSheet));
    setCostInk(String(profile.inkRsPerFullPage));
    setCostOpen(true);
  };
  const saveCostDialog = () => {
    const next: CostProfile = {
      paperRsPerSheet: Math.max(0, Number(costPaper) || 0),
      inkRsPerFullPage: Math.max(0, Number(costInk) || 0),
    };
    saveCostProfile(next);
    setProfile(next);
    setCostOpen(false);
    toast({ description: t('rs.cost.saved') });
  };

  // F6 — share the CONVERTED PDF itself (no ink/paper receipt) to WhatsApp or
  // Telegram. Mobile: OS share sheet carries the file — the user picks the
  // app. Desktop fallback: download the PDF + open the chat with a plain
  // note so the user attaches the downloaded file there.
  const [waBusy, setWaBusy] = useState(false);
  const sharePdfTo = async (target: 'wa' | 'tg') => {
    if (!result || waBusy) return;
    setWaBusy(true);
    const text = t('rs.share.text');
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.share === 'function' && nav.canShare) {
        try {
          const blob = await fetch(result.url).then((r) => r.blob());
          const file = new File([blob], 'notes-printifier.pdf', { type: 'application/pdf' });
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], title: 'Notes Printifier' });
            toast({ description: t('rs.wa.shared') });
            return;
          }
        } catch (shareErr) {
          if (shareErr instanceof DOMException && shareErr.name === 'AbortError') return;
          console.debug('Web Share failed, falling back to download + chat link', shareErr);
        }
      }
      // No file-share support (typical desktop): hand over the PDF and open
      // the chat — the stats receipt is deliberately NOT included.
      const blob = await fetch(result.url).then((r) => r.blob());
      downloadBlob(blob, 'notes-printifier.pdf');
      const shareUrl =
        target === 'wa'
          ? `https://wa.me/?text=${encodeURIComponent(text)}`
          : `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(text)}`;
      window.open(shareUrl, '_blank', 'noopener');
      toast({ description: t('rs.share.fallback') });
    } catch (err) {
      console.error('PDF share failed', err);
      toast({ description: t('rs.share.fail') });
    } finally {
      setWaBusy(false);
    }
  };

  if (!result) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        {t('rs.noResult')}
      </div>
    );
  }

  const paperSavedPct =
    result.inputPages > 0
      ? Math.max(0, Math.round((1 - result.outputPages / result.inputPages) * 100))
      : 0;
  const sizeDeltaPct =
    result.inputBytes > 0
      ? Math.round(((result.inputBytes - result.outputBytes) / result.inputBytes) * 100)
      : 0;

  const savings = estimateSavings(
    {
      inputPages: result.inputPages,
      outputPages: result.outputPages,
      inkSavedPct: result.inkSavedPct,
      beforeInkPct: result.beforeInkPct,
    },
    profile,
  );

  // F7 — weekly streak + milestone tier for the lifetime sheets saved
  const streak = computeStreak(loadJobLog());
  const milestone = milestoneFor(impact?.sheetsSaved ?? 0);
  /** Receipt chip: e.g. "3-week streak · Gold" (omitted when nothing to show). */
  const receiptBadge =
    streak.streakWeeks >= 1 || milestone.tierKey
      ? [
          streak.streakWeeks >= 1
            ? `${t('im.streak.weeks', { n: streak.streakWeeks })} 🔥`
            : null,
          milestone.tierKey ? t(milestone.tierKey) : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined
      : undefined;

  const stats = [
    {
      label: t('rs.pages'),
      value: `${result.inputPages} → ${result.outputPages}`,
      sub: paperSavedPct > 0 ? t('rs.lessPaper', { n: paperSavedPct }) : t('rs.samePaper'),
      tone: 'text-primary',
    },
    {
      label: t('rs.inkSaved'),
      value: `${result.inkSavedPct}%`,
      sub: t('rs.mode', { m: t(MODE_I18N_KEY[filters.colorMode]) }),
      tone: 'text-emerald-400',
    },
    {
      label: t('rs.size'),
      value: formatMB(result.outputBytes),
      sub:
        sizeDeltaPct >= 0
          ? t('rs.smaller', { n: sizeDeltaPct })
          : t('rs.larger', { n: -sizeDeltaPct }),
      tone: 'text-foreground',
    },
    {
      label: t('rs.layout'),
      value: `${layout.rows} × ${layout.cols}`,
      sub: `${layout.pageSize === 'original' ? t('ly.original') : layout.pageSize.toUpperCase()} · ${layout.orientation}`,
      tone: 'text-foreground',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold">{t('rs.ready')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('rs.sub')}</p>
        {result.searchable && (
          <Badge className="mt-3 border-0 bg-emerald-500/15 text-emerald-300">
            <ScanText className="mr-1.5 h-3.5 w-3.5" /> {t('rs.searchable')}
          </Badge>
        )}
        {result.repainted > 0 && (
          <Badge className="mt-3 ml-2 border-0 bg-violet-500/15 text-violet-300">
            <Type className="mr-1.5 h-3.5 w-3.5" /> {t('rs.repainted', { n: result.repainted })}
          </Badge>
        )}
        {filters.colorMode === 'auto' && result.autoInverted > 0 && (
          <p className="mt-2 text-xs text-violet-300">
            {t('rs.autoInverted', { n: result.autoInverted, t: result.inputPages })}
          </p>
        )}
        {result.sizeTargetMB && (
          <p className="mt-2 text-xs text-violet-300">
            {result.sizeAttempts > 0
              ? t('rs.sizeTargetFit', { n: result.sizeTargetMB, p: result.sizeAttempts })
              : t('rs.sizeTargetAlready', { n: result.sizeTargetMB })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </p>
            <p className={`mt-1 text-xl font-extrabold ${s.tone}`}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {savings.rupees > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-200">
          <IndianRupee className="h-4 w-4 shrink-0 text-emerald-300" />
          <span>
            {t('rs.saved', { rs: formatRupees(savings.rupees) })} — {t('rs.savedDetail', { n: savings.sheetsSaved })}
            <span className="block text-xs text-emerald-300/70">
              {t('rs.assume2', { p: profile.paperRsPerSheet, i: profile.inkRsPerFullPage })}
              {!costProfileIsDefault(profile) && ` · ${t('rs.cost.hint')}`}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openCostDialog}
            className="h-7 shrink-0 border-emerald-400/40 bg-emerald-500/10 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
          >
            <Pencil className="mr-1 h-3 w-3" /> {t('rs.cost.edit')}
          </Button>
        </div>
      )}

      {/* Shareable receipt card — stats for the class group, 100% on-device */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void makeReceipt()}
          disabled={receiptBusy}
          className="h-9 border-violet-400/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
        >
          {receiptBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ImageDown className="mr-2 h-4 w-4 text-violet-300" />
          )}
          {t('rs.receipt.btn')}
        </Button>
        <ListenButton />
      </div>

      {/* Lifetime impact meter — pure local data, one tap to clear */}
      {impact && (
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <Leaf className="h-4 w-4 text-emerald-300" /> {t('rs.impactTitle')}
            </p>
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-red-300 hover:underline"
              onClick={() => {
                resetInkStats();
                setImpact(null);
              }}
            >
              {t('rs.impactReset')}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-white/[0.04] p-2.5 text-center">
              <p className="text-base font-bold">{impact.jobs}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('rs.impactJobs')}</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2.5 text-center">
              <p className="text-base font-bold">{impact.sheetsSaved}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('rs.impactSheets')}</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2.5 text-center">
              <p className="text-base font-bold text-emerald-300">{formatRupees(impact.rupees)}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('rs.impactMoney')}</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2.5 text-center">
              <p className="text-base font-bold">{impact.sheetsSaved >= 417 ? `${treesFor(impact.sheetsSaved)} 🌳` : `${(co2GramsFor(impact.sheetsSaved) / 1000).toFixed(2)} kg`}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {impact.sheetsSaved >= 417 ? t('rs.impactTrees') : t('rs.impactCo2')}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">{t('rs.impactNote')}</p>

          {/* F7 — weekly streak + milestone progress */}
          {streak.totalJobs > 0 && (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                  <Flame className="h-3.5 w-3.5 text-amber-300" />
                  {t('im.streak.title')}
                </p>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {streak.streakWeeks > 0 ? (
                    <Badge className="border-0 bg-amber-500/15 text-amber-200">
                      🔥 {t('im.streak.weeks', { n: streak.streakWeeks })}
                    </Badge>
                  ) : (
                    <span className="italic">{t('im.streak.none')}</span>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {t('im.streak.thisweek', { n: streak.weekCount })}
                  </Badge>
                </span>
              </div>
              {milestone.nextKey ? (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {milestone.tierKey ? t(milestone.tierKey) : '—'}
                    </span>
                    <span className="font-semibold text-emerald-300">
                      {t('im.streak.next', {
                        n: milestone.sheetsToNext,
                        tier: t(milestone.nextKey),
                      })}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-[width] duration-500"
                      style={{ width: `${milestone.progressPct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] font-semibold text-amber-300">
                  {t('im.streak.max')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {result.ocrWarning && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm text-amber-300">
          {result.ocrWarning}
        </p>
      )}

      {/* Personal savings history — pure local data, no account needed */}
      {history && history.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4 text-violet-300" /> {t('rs.histTitle')}
            </p>
            <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px]">
              {t('rs.histNote', { n: history.length, s: history.length === 1 ? '' : 's' })}
            </Badge>
          </div>
          <ul className="space-y-2.5">
            {history.map((job) => (
              <li key={job.id} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {new Date(job.ts).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                <div
                  className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"
                  role="img"
                  aria-label={`${job.inputPages} → ${job.outputPages}, ${t('rs.inkSaved')} ${job.inkSavedPct}%`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                    style={{ width: `${Math.max(4, Math.min(100, job.inkSavedPct))}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {job.inputPages}→{job.outputPages}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={result.url}
          download="notes-printifier.pdf"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition-all hover:from-violet-500 hover:to-fuchsia-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <Download className="h-4 w-4" /> {t('rs.download')}
        </a>
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-6 text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <ExternalLink className="h-4 w-4" /> {t('rs.open')}
        </a>
        <Button
          type="button"
          size="lg"
          onClick={() => void sharePdfTo('wa')}
          disabled={waBusy}
          aria-label={t('rs.wa.aria')}
          className="w-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 shadow-none hover:bg-emerald-500/25 sm:w-auto"
        >
          {waBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
          {t('rs.wa')}
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => void sharePdfTo('tg')}
          disabled={waBusy}
          aria-label={t('rs.tg.aria')}
          className="w-full border border-sky-400/40 bg-sky-500/15 text-sky-200 shadow-none hover:bg-sky-500/25 sm:w-auto"
        >
          {waBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TelegramIcon className="mr-2 h-4 w-4" />}
          {t('rs.tg')}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={reset} className="w-full sm:w-auto">
          <RotateCcw className="mr-2 h-4 w-4" /> {t('rs.another')}
        </Button>
      </div>

      {layout.booklet && (
        <div className="flex items-start gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
          <p>
            <span className="font-semibold">{t('rs.bookletTitle')}</span>{' '}
            {t('rs.bookletBody')}
          </p>
        </div>
      )}

      {/* Manual-duplex split: valid for plain N-up (output page = sheet) but
          NOT for booklet — saddle-stitch order must stay interleaved for the
          fold, so booklet users get the print-dialog note above instead. */}
      {result.outputPages >= 3 && !layout.booklet && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Scissors className="h-4 w-4 text-violet-300" /> {t('rs.duplexTitle')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('rs.duplexBody')}
              </p>
            </div>
            {!duplex && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void makeDuplexFiles()}
                disabled={splitting}
                className="shrink-0"
              >
                {splitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-2 h-4 w-4" />
                )}
                {t('rs.duplexBtn')}
              </Button>
            )}
          </div>
          {duplex && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <a
                href={duplex.oddUrl}
                download="odd-sheets.pdf"
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4" /> {t('rs.odd', { n: duplex.oddCount })}
              </a>
              <a
                href={duplex.evenUrl}
                download="even-sheets.pdf"
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4" /> {t('rs.even', { n: duplex.evenCount })}
              </a>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('rs.previewLabel')}
        </p>
        {iosLike ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-zinc-950 px-6 py-10 text-center">
            <Smartphone className="h-7 w-7 text-violet-300" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {t('rs.iosBody')}
            </p>
          </div>
        ) : (
          <iframe
            src={result.url}
            title="Generated PDF preview"
            className="h-[420px] w-full rounded-xl border border-white/10 bg-white sm:h-[480px]"
          />
        )}
      </div>

      {/* F5 — print cost profile dialog */}
      <Dialog open={costOpen} onOpenChange={setCostOpen}>
        <DialogContent className="max-w-md rounded-2xl border-white/10 bg-popover">
          <DialogHeader>
            <DialogTitle className="text-left">{t('rs.cost.title')}</DialogTitle>
            <DialogDescription className="text-left">{t('rs.cost.hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cost-paper">{t('rs.cost.paper')}</Label>
              <Input
                id="cost-paper"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                value={costPaper}
                onChange={(e) => setCostPaper(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-ink">{t('rs.cost.ink')}</Label>
              <Input
                id="cost-ink"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.1}
                value={costInk}
                onChange={(e) => setCostInk(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
                onClick={saveCostDialog}
              >
                {t('rs.cost.save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  saveCostProfile(DEFAULT_COST);
                  setProfile(DEFAULT_COST);
                  setCostOpen(false);
                }}
              >
                {t('rs.cost.reset')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
