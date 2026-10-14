'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePrintifyStore, getDocBuffer } from '@/lib/printify-store';
import { loadPdfDocument } from '@/lib/pdf/pdfjs';
import { applyFilters, inkCoverage, trimCanvasMargins } from '@/lib/pdf/filters';
import { useT } from '@/lib/i18n';

/**
 * Full before/after preview (#6) — every SELECTED page of the user's own
 * file, navigable, rendered at high preview resolution with the exact
 * pipeline used by the final output (filters + trim).
 */
export function PreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);

  const selected = pages.filter((p) => p.selected);
  const [idx, setIdx] = useState(0);
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const page = selected[Math.min(idx, Math.max(0, selected.length - 1))];

  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  const render = useCallback(async () => {
    if (!page) return;
    const buf = getDocBuffer(page.docId);
    if (!buf) return;
    setBusy(true);
    try {
      const doc = await loadPdfDocument(buf);
      let canvas = await (await import('@/lib/pdf/render')).renderPageToCanvas(doc, page.pageNumber, {
        targetWidth: 720,
        extraRotation: page.rotation,
      });
      setBefore(canvas.toDataURL('image/jpeg', 0.75));
      applyFilters(canvas, filters);
      if (filters.trimMargins) {
        const trimmed = trimCanvasMargins(canvas);
        if (trimmed !== canvas) canvas = trimmed;
      }
      setAfter(canvas.toDataURL('image/jpeg', 0.75));
    } catch (err) {
      console.error('Preview render failed', err);
    } finally {
      setBusy(false);
    }
  }, [page?.id, page?.rotation, filters]);

  useEffect(() => {
    if (!open) return;
    void render();
  }, [open, render]);

  // keyboard navigation while open
  useEffect(() => {
    if (!open || selected.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(selected.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selected.length]);

  if (!page) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-2xl border-white/10 bg-popover p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-left">
            {t('en.preview.full')}
            <Badge variant="outline" className="ml-2 border-white/15 bg-white/5 text-[11px] font-medium">
              {t('en.preview.page', { n: Math.min(idx, selected.length - 1) + 1, t: selected.length })}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-left">
            {t('en.preview.note')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="space-y-1.5">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('en.preview.before')}
            </figcaption>
            <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
              {before ? (
                <img src={before} alt="Original page preview" className="w-full" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </figure>
          <figure className="space-y-1.5">
            <figcaption className="relative text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('en.preview.after')}
              {busy && (
                <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-violet-300" />
              )}
            </figcaption>
            <div className="overflow-hidden rounded-xl border border-primary/30 bg-zinc-950">
              {after ? (
                <img src={after} alt="Enhanced page preview" className="w-full" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </figure>
        </div>

        {selected.length > 1 && (
          <div className="mt-1 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              aria-label={t('pg.moveEarlier')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="range"
              min={0}
              max={selected.length - 1}
              value={Math.min(idx, selected.length - 1)}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="w-48 accent-violet-500"
              aria-label={t('en.preview.page', { n: idx + 1, t: selected.length })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={idx >= selected.length - 1}
              onClick={() => setIdx((i) => Math.min(selected.length - 1, i + 1))}
              aria-label={t('pg.moveLater')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
