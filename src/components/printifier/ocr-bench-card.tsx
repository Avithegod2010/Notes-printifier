'use client';

import { useCallback, useMemo, useState } from 'react';
import { FlaskConical, Loader2, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';
import { benchPsmModes, type PsmBenchRow } from '@/lib/pdf/ocr-bench';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * OcrBench — the OCR accuracy benchmark, printed inside the Doctor card.
 *
 * Runs the SAME page through both recognition modes (PSM 3 vs PSM 6) and
 * shows confidence / word count / time side by side, with a one-tap "Use
 * <winner>" that flips the Recognition-mode select. Users see WHY to switch
 * instead of guessing — the same manual pass that caught the OCR inversion,
 * now automated.
 */
export function OcrBench() {
  const t = useT();
  const docs = usePrintifyStore((s) => s.docs);
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const setFilters = usePrintifyStore((s) => s.setFilters);

  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<PsmBenchRow[] | null>(null);

  const firstSel = useMemo(
    () => pages.find((p) => p.selected) ?? pages[0] ?? null,
    [pages],
  );

  const run = useCallback(async () => {
    if (busy || docs.length === 0 || !firstSel) return;
    setBusy(true);
    setRows(null);
    try {
      const { getDocBuffer } = await import('@/lib/printify-store');
      const buf = getDocBuffer(firstSel.docId);
      if (!buf) throw new Error('missing buffer');
      const langs = filters.ocrLangs ?? ['eng'];
      const out = await benchPsmModes(buf, firstSel.pageNumber, langs);
      setRows(out);
    } catch {
      toast({ description: t('dr.bench.fail') });
    } finally {
      setBusy(false);
    }
  }, [busy, docs.length, firstSel, filters.ocrLangs, t]);

  const winner = useMemo(() => {
    if (!rows || rows.length < 2) return null;
    // Confidence decides; ties break on the higher word count, then speed.
    const sorted = [...rows].sort(
      (a, b) => b.confidence - a.confidence || b.words - a.words || a.ms - b.ms,
    );
    return sorted[0];
  }, [rows]);

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <FlaskConical className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
          {t('dr.bench.title')}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 border-fuchsia-400/40 bg-fuchsia-500/10 px-2.5 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/20"
          disabled={busy || docs.length === 0 || !firstSel}
          onClick={() => void run()}
          data-testid="ocr-bench-run"
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> {t('dr.bench.running')}
            </>
          ) : (
            rows ? t('dr.bench.again') : t('dr.bench.run')
          )}
        </Button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t('dr.bench.sub')}</p>
      {firstSel && (
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          {t('dr.bench.page', { n: firstSel.pageNumber, name: docs.find((d) => d.id === firstSel.docId)?.name ?? '' })}
        </p>
      )}

      {rows && rows.length === 2 && (
        <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-white/[0.04] text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-semibold">{t('dr.bench.mode')}</th>
                <th className="px-2 py-1.5 text-right font-semibold">{t('dr.bench.conf')}</th>
                <th className="px-2 py-1.5 text-right font-semibold">{t('dr.bench.words')}</th>
                <th className="px-2 py-1.5 text-right font-semibold">{t('dr.bench.time')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isWinner = winner?.psm === r.psm;
                return (
                  <tr
                    key={r.psm}
                    className={cn('border-t border-white/10', isWinner && 'bg-emerald-500/[0.07]')}
                  >
                    <td className="px-2 py-1.5 font-semibold">
                      <span className="inline-flex items-center gap-1">
                        PSM {r.psm}
                        {isWinner && (
                          <Trophy className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                        )}
                        {r.psm === '3' ? (
                          <span className="text-muted-foreground"> · {t('en.ocrPsm.auto')}</span>
                        ) : (
                          <span className="text-muted-foreground"> · {t('en.ocrPsm.block')}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.confidence}%</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.words}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{(r.ms / 1000).toFixed(1)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {winner && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className="border-0 bg-emerald-500/15 text-[10px] text-emerald-200"
          >
            {t('dr.bench.winner', { psm: winner.psm })}
          </Badge>
          <Button
            type="button"
            size="sm"
            className="h-7 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-2.5 text-[11px] text-white hover:from-violet-500 hover:to-fuchsia-500"
            onClick={() => {
              setFilters({ ocrPsm: winner.psm });
              toast({ description: t('dr.bench.applied', { psm: winner.psm }) });
            }}
            data-testid="ocr-bench-apply"
          >
            {winner.psm === '6' ? t('dr.bench.use6') : t('dr.bench.use3')}
          </Button>
        </div>
      )}
    </div>
  );
}
