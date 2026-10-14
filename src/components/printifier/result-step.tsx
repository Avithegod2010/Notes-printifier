'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  IndianRupee,
  Loader2,
  Printer,
  RotateCcw,
  Scissors,
  Smartphone,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { Button } from '@/components/ui/button';
import { usePrintifyStore } from '@/lib/printify-store';
import { COLOR_MODE_LABELS } from '@/lib/pdf/filters';
import { estimateSavings, formatRupees } from '@/lib/savings';

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ResultStep() {
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

  if (!result) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        No result yet — process a file first.
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

  const savings = estimateSavings({
    inputPages: result.inputPages,
    outputPages: result.outputPages,
    inkSavedPct: result.inkSavedPct,
    beforeInkPct: result.beforeInkPct,
  });

  const stats = [
    {
      label: 'Pages',
      value: `${result.inputPages} → ${result.outputPages}`,
      sub: paperSavedPct > 0 ? `${paperSavedPct}% less paper` : 'same paper',
      tone: 'text-primary',
    },
    {
      label: 'Est. ink saved',
      value: `${result.inkSavedPct}%`,
      sub: `mode: ${COLOR_MODE_LABELS[filters.colorMode].title}`,
      tone: 'text-emerald-400',
    },
    {
      label: 'Output size',
      value: formatMB(result.outputBytes),
      sub:
        sizeDeltaPct >= 0
          ? `${sizeDeltaPct}% smaller than source`
          : `${-sizeDeltaPct}% larger (quality boost)`,
      tone: 'text-foreground',
    },
    {
      label: 'Layout',
      value: `${layout.rows} × ${layout.cols}`,
      sub: `${layout.pageSize === 'original' ? 'original size' : layout.pageSize.toUpperCase()} · ${layout.orientation}`,
      tone: 'text-foreground',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold">Your print-ready PDF is ready! 🎉</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download it and hit print — your wallet and the planet thank you.
        </p>
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
            You saved about{' '}
            <span className="font-extrabold text-emerald-300">
              {formatRupees(savings.rupees)}
            </span>{' '}
            — {savings.sheetsSaved} sheet{savings.sheetsSaved === 1 ? '' : 's'} of paper + ink
            <span className="block text-xs text-emerald-300/70">
              rough estimate: ~₹1 per sheet of paper, ink by measured coverage
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={result.url}
          download="notes-printifier.pdf"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition-all hover:from-violet-500 hover:to-fuchsia-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <Download className="h-4 w-4" /> Download PDF
        </a>
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-6 text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <ExternalLink className="h-4 w-4" /> Open
        </a>
        <Button type="button" variant="outline" size="lg" onClick={reset} className="w-full sm:w-auto">
          <RotateCcw className="mr-2 h-4 w-4" /> Process another file
        </Button>
      </div>

      {layout.booklet && (
        <div className="flex items-start gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
          <p>
            <span className="font-semibold">Booklet printing:</span> in the print dialog
            choose landscape + duplex with <span className="font-semibold">“flip on short edge”</span>.
            Print the whole file, stack the sheets in order, fold once in the middle
            (the separator line is your fold guide) — done.
          </p>
        </div>
      )}

      {result.outputPages >= 3 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Scissors className="h-4 w-4 text-violet-300" /> No duplex printer?
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Split into odd/even files: print the odd file, flip the stack, print the
                even file on the back.
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
                Create odd &amp; even files
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
                <Download className="h-4 w-4" /> Odd sheets ({duplex.oddCount})
              </a>
              <a
                href={duplex.evenUrl}
                download="even-sheets.pdf"
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4" /> Even sheets ({duplex.evenCount})
              </a>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Output preview
        </p>
        {iosLike ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-zinc-950 px-6 py-10 text-center">
            <Smartphone className="h-7 w-7 text-violet-300" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">
              iOS can&apos;t display PDFs inside the page — but your file is ready.
              Tap <span className="font-semibold text-foreground">Open</span> to view it
              full-screen, or <span className="font-semibold text-foreground">Download</span>{' '}
              to save it for printing.
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
    </div>
  );
}
