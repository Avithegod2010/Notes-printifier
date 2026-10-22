'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileArchive,
  Layers,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import { zipSync } from 'fflate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  JobCancelled,
  runComposeJob,
  saveJobSideEffects,
  usePrintifyStore,
  type ComposeJobOutput,
} from '@/lib/printify-store';
import { allPresets } from '@/lib/presets';
import { recordJob } from '@/lib/ink-stats';
import { loadCostProfile, estimateSavings, formatRupees } from '@/lib/savings';
import { downloadBlob } from '@/lib/recent-jobs';
import { useLangStore } from '@/lib/i18n';
import { useT } from '@/lib/i18n';

/**
 * F3 — batch queue. One preset per uploaded file; each file is composed into
 * its OWN PDF (same pipeline as the wizard — booklet, cover, size target,
 * OCR all honoured), one after another, with per-file downloads at the end.
 */

interface BatchDone {
  name: string;
  blob: Blob;
  url: string;
  outputPages: number;
  rupees: number;
}

export function BatchQueue() {
  const t = useT();
  const docs = usePrintifyStore((s) => s.docs);
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const layout = usePrintifyStore((s) => s.layout);
  const labsTextRepaint = usePrintifyStore((s) => s.labsTextRepaint);
  const presets = usePrintifyStore((s) => s.presets);

  const [open, setOpen] = useState(false);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [curIdx, setCurIdx] = useState(-1);
  const [live, setLive] = useState<{ done: number; total: number; ocr?: boolean } | null>(null);
  const [done, setDone] = useState<BatchDone[]>([]);
  const [errors, setErrors] = useState<Record<number, boolean>>({});
  const [zipping, setZipping] = useState(false);
  const cancelRef = useRef(false);
  const urlsRef = useRef<string[]>([]);

  // revoke object URLs when the queue is cleared / unmounted
  useEffect(() => {
    const urls = urlsRef;
    return () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    };
  }, []);

  const options = useMemo(
    () => [{ id: 'current', name: t('up.batch.current') }, ...presets],
    [presets, t],
  );

  const presetFor = useCallback(
    (id: string): { filters: typeof filters; layout: typeof layout } => {
      if (id === 'current') return { filters, layout };
      const p = allPresets().find((x) => x.id === id);
      if (p) return { filters: p.filters, layout: p.layout };
      return { filters, layout };
    },
    [filters, layout],
  );

  const resetQueue = useCallback(() => {
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
    setDone([]);
    setErrors({});
    setCurIdx(-1);
    setLive(null);
  }, []);

  const runQueue = async () => {
    if (running || docs.length === 0) return;
    cancelRef.current = false;
    setRunning(true);
    resetQueue();
    const cost = loadCostProfile();
    const lang = useLangStore.getState().lang;

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      setCurIdx(i);
      const jobPages = pages.filter((p) => p.docId === doc.id);
      if (jobPages.every((p) => !p.selected)) {
        setErrors((e) => ({ ...e, [doc.id]: true }));
        continue;
      }
      try {
        const { filters: jf, layout: jl } = presetFor(assign[doc.id] ?? 'current');
        const out: ComposeJobOutput = await runComposeJob({
          docs: [doc],
          pages: jobPages,
          filters: jf,
          layout: jl,
          repaint: labsTextRepaint,
          lang,
          onProgress: (p) => setLive(p),
          isActive: () => !cancelRef.current,
        });
        if (cancelRef.current) break;
        recordJob({
          inputPages: out.selectedCount,
          outputPages: out.result.outputPages,
          inkSavedPct: out.result.inkSavedPct,
          beforeInkPct: out.result.beforeInkPct,
        });
        const layoutLabel = jl.booklet ? 'booklet' : `${jl.rows}x${jl.cols}`;
        void saveJobSideEffects(out, layoutLabel, jf.colorMode, [doc]);
        const url = URL.createObjectURL(out.blob);
        urlsRef.current.push(url);
        const sav = estimateSavings(
          {
            inputPages: out.selectedCount,
            outputPages: out.result.outputPages,
            inkSavedPct: out.result.inkSavedPct,
            beforeInkPct: out.result.beforeInkPct,
          },
          cost,
        );
        setDone((d) => [
          ...d,
          {
            name: doc.name.replace(/\.pdf$/i, ''),
            blob: out.blob,
            url,
            outputPages: out.result.outputPages,
            rupees: sav.rupees,
          },
        ]);
      } catch (err) {
        if (err instanceof JobCancelled || cancelRef.current) break;
        console.error('Batch job failed:', err);
        setErrors((e) => ({ ...e, [doc.id]: true }));
      } finally {
        setLive(null);
      }
    }
    setRunning(false);
    setCurIdx(-1);
  };

  /** F15 — pack every finished PDF into one .zip (no multi-download
   *  popups for the browser to block). zipSync runs on the main thread,
   *  which is fine for a handful of megabytes and avoids worker/CSP quirks. */
  const downloadAllZip = () => {
    if (zipping || done.length === 0) return;
    setZipping(true);
    (async () => {
      const files: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      for (const d of done) {
        const base = `${d.name}-printified-${d.outputPages}p`;
        let name = `${base}.pdf`;
        for (let n = 2; used.has(name); n++) name = `${base} (${n}).pdf`;
        used.add(name);
        files[name] = new Uint8Array(await d.blob.arrayBuffer());
      }
      const data = zipSync(files, { level: 0 }); // PDFs are already compressed
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([data as unknown as BlobPart], { type: 'application/zip' }),
        `printifier-batch-${stamp}.zip`,
      );
    })()
      .catch((err) => console.error('ZIP export failed:', err))
      .finally(() => setZipping(false));
  };

  if (docs.length === 0) return null;

  const totalRupees = done.reduce((s, d) => s + d.rupees, 0);
  const finishedAll = !running && done.length + Object.keys(errors).length >= docs.length && done.length + Object.keys(errors).length > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-violet-300" />
          {t('up.batch')}
          <Badge className="ml-1 border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
            {t('en.badge.new')}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {docs.length}
          </Badge>
        </span>
        <span className={`text-xs text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{t('up.batch.sub')}</p>

          <ul className="pretty-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
            {docs.map((d, i) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="w-5 shrink-0 text-center text-[11px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('up.batch.pages', { n: d.pageCount })}
                  </p>
                </div>
                <Select
                  value={assign[d.id] ?? 'current'}
                  onValueChange={(v) => setAssign((a) => ({ ...a, [d.id]: v }))}
                  disabled={running}
                >
                  <SelectTrigger className="h-8 w-[150px] shrink-0 text-xs" aria-label={t('up.batch.preset')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="flex w-6 shrink-0 justify-center">
                  {running && curIdx === docs.indexOf(d) && (
                    <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                  )}
                  {done.some((x) => x.name === d.name.replace(/\.pdf$/i, '')) && curIdx !== docs.indexOf(d) && (
                    <Check className="h-4 w-4 text-emerald-400" />
                  )}
                  {errors[d.id] && <XCircle className="h-4 w-4 text-red-400" />}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            {!running ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void runQueue()}
                className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
              >
                {t('up.batch.run', { n: docs.length })}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                <X className="mr-1.5 h-4 w-4" /> {t('up.batch.cancel')}
              </Button>
            )}
            {running && (
              <span className="text-xs text-muted-foreground">
                {t('up.batch.job', { i: curIdx + 1, n: docs.length })}
                {live ? ` · ${t('up.batch.page', { d: live.done, t: live.total })}` : ''}
              </span>
            )}
          </div>

          {running && live && (
            <Progress
              value={Math.round(((curIdx + live.done / Math.max(1, live.total)) / docs.length) * 100)}
              className="h-2"
            />
          )}

          {done.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-300">
                {finishedAll
                  ? t('up.batch.done', { n: done.length })
                  : `${done.length}/${docs.length}`}
                {totalRupees > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t('up.batch.saved', { rs: formatRupees(totalRupees) })}
                  </span>
                )}
              </p>
              <ul className="space-y-2">
                {done.map((d) => (
                  <li
                    key={d.url}
                    className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-3 py-2"
                  >
                    <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {d.name}
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {d.outputPages}p · {formatRupees(d.rupees)}
                      </span>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={() => downloadBlob(d.blob, `${d.name}-printified-${d.outputPages}p.pdf`)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" /> {t('up.batch.dl')}
                    </Button>
                  </li>
                ))}
              </ul>
              {done.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={downloadAllZip}
                  disabled={zipping}
                >
                  {zipping ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <FileArchive className="mr-1.5 h-4 w-4" />
                  )}
                  {zipping ? t('up.batch.zipBusy') : t('up.batch.dlZip')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
