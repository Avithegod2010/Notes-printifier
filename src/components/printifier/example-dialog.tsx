'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, FileDown, Loader2, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getPdfjs, PDF_WASM_URL, type PdfDocument } from '@/lib/pdf/pdfjs';

const BEFORE_URL = '/sample-lecture.pdf';
const BEFORE_NAME = 'original-lecture.pdf';
const AFTER_URL = '/sample-printified.pdf';
const AFTER_NAME = 'lecture-printified.pdf';
/** Preview render width in CSS px (canvases are dpr-aware). */
const PREVIEW_WIDTH = 300;
/** Measured ink drop of the bundled example (regenerate with scripts/generate-sample-output.ts). */
const EXAMPLE_INK_SAVED_PCT = 87;

interface SideStats {
  pages: number;
  bytes: number;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ExampleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "See a real example" dialog — loads two bundled PDFs (the untouched 41-page
 * dark lecture and its printified output) and renders EVERY page of both,
 * client-side, with pdf.js.
 *
 * All pages are rendered LAZILY: each side shows skeleton slots for every
 * page immediately and an IntersectionObserver rooted at the scrolling box
 * queues real renders as slots scroll into view (55 canvases would be far
 * too slow to render up-front).
 *
 * NOTE: the loading logic lives in <ExamplePanels/>, a child of
 * DialogContent. Radix mounts DialogContent through a portal in a second
 * commit, so an effect on the parent keyed by `open` can fire before the
 * portal content (and its refs) exist. As a child of DialogContent,
 * ExamplePanels mounts exactly when the dialog is visible and its refs are
 * guaranteed to be attached before its own effect runs.
 */
export function ExampleDialog({ open, onOpenChange }: ExampleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold tracking-tight">
            A real example — before &amp; after
          </DialogTitle>
          <DialogDescription>
            Every page of an actual 41-page lecture PDF, processed with the
            default settings (Invert + Ink Saver + 3 slides per sheet). Same
            tool, same pipeline — nothing staged. Scroll each panel to see all
            pages.
          </DialogDescription>
        </DialogHeader>
        <ExamplePanels />
      </DialogContent>
    </Dialog>
  );
}

interface Slot {
  el: HTMLDivElement;
  page: number;
}

/**
 * One preview panel (before OR after): skeleton slot per page, lazily
 * rendered into real canvases as they scroll into view.
 */
class LazySide {
  private slots: Slot[] = [];
  private queued = new Set<number>();
  private queue: number[] = [];
  private pumping = false;
  private observer: IntersectionObserver | null = null;
  private tasks: Array<{ cancel: () => void }> = [];
  private cancelled = false;

  constructor(
    private doc: PdfDocument,
    private box: HTMLDivElement,
  ) {}

  /** Build all page slots and start observing. Resolves when slots exist. */
  async build(): Promise<void> {
    const first = await this.doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    first.cleanup();
    const ratio = `${base.width} / ${base.height}`;

    const frag = document.createDocumentFragment();
    for (let p = 1; p <= this.doc.numPages; p++) {
      const wrap = document.createElement('div');
      wrap.className = 'relative w-full overflow-hidden rounded-md border border-white/10 bg-white/[0.04]';
      wrap.style.aspectRatio = ratio;
      wrap.dataset.page = String(p);

      const shimmer = document.createElement('div');
      shimmer.className = 'absolute inset-0 animate-pulse bg-white/[0.06]';
      shimmer.dataset.role = 'shimmer';
      wrap.appendChild(shimmer);

      const label = document.createElement('span');
      label.className =
        'absolute right-1 bottom-1 z-10 rounded bg-black/50 px-1 text-[9px] leading-4 text-white';
      label.textContent = String(p);
      wrap.appendChild(label);

      frag.appendChild(wrap);
      this.slots.push({ el: wrap, page: p });
    }
    this.box.appendChild(frag);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const page = Number((e.target as HTMLElement).dataset.page ?? 0);
          if (page > 0 && !this.queued.has(page)) {
            this.queued.add(page);
            this.queue.push(page);
          }
        }
        if (this.queue.length > 0) void this.pump();
      },
      { root: this.box, rootMargin: '120px 0px' },
    );
    for (const s of this.slots) this.observer.observe(s.el);
  }

  /** Render queued pages one at a time (keeps the UI responsive). */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.cancelled) {
        const page = this.queue.shift()!;
        await this.render(page);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async render(page: number): Promise<void> {
    const slot = this.slots[page - 1];
    if (!slot || this.cancelled) return;
    const p = await this.doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = p.getViewport({ scale: (PREVIEW_WIDTH * dpr) / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.className = 'block h-auto w-full';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = p.render({ canvas, canvasContext: ctx, viewport });
    this.tasks.push(task);
    await task.promise.catch(() => undefined);
    p.cleanup();
    if (this.cancelled) return;

    // drop the shimmer, keep the page-number label on top
    slot.el.querySelector('[data-role="shimmer"]')?.remove();
    const label = slot.el.querySelector('span');
    if (label) slot.el.insertBefore(canvas, label);
    else slot.el.appendChild(canvas);
  }

  destroy(): void {
    this.cancelled = true;
    this.queue = [];
    this.observer?.disconnect();
    this.observer = null;
    this.tasks.forEach((t) => {
      try {
        t.cancel();
      } catch {
        // already finished
      }
    });
    this.tasks = [];
    if (this.box) this.box.textContent = '';
  }
}

function ExamplePanels() {
  const beforeBox = useRef<HTMLDivElement>(null);
  const afterBox = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<{ before: SideStats; after: SideStats } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again" — remounts the loading effect. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sides: LazySide[] = [];
    // pdf.js v6 removed PDFDocumentProxy.destroy() — cleanup must go through
    // the PDFDocumentLoadingTask returned by getDocument().
    const loadTasks: Array<{ destroy: () => void }> = [];
    // a retry may leave canvases from a previous (partial) run behind
    if (beforeBox.current) beforeBox.current.textContent = '';
    if (afterBox.current) afterBox.current.textContent = '';

    async function loadDoc(url: string) {
      const pdfjs = await getPdfjs();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load ${url}`);
      const buf = await res.arrayBuffer();
      const loadTask = pdfjs.getDocument({
        data: new Uint8Array(buf.slice(0)),
        wasmUrl: PDF_WASM_URL,
      });
      loadTasks.push(loadTask);
      const doc = await loadTask.promise;
      if (cancelled) {
        void loadTask.destroy();
        throw new Error('cancelled');
      }
      return { doc, bytes: buf.byteLength };
    }

    void (async () => {
      try {
        const [before, after] = await Promise.all([
          beforeBox.current
            ? loadDoc(BEFORE_URL)
            : Promise.reject(new Error('before box missing')),
          afterBox.current
            ? loadDoc(AFTER_URL)
            : Promise.reject(new Error('after box missing')),
        ]);
        if (cancelled) return;

        // Build the lazy panels — skeleton slots for every page appear
        // immediately; real canvases stream in as the user scrolls.
        const beforeSide = new LazySide(before.doc, beforeBox.current!);
        const afterSide = new LazySide(after.doc, afterBox.current!);
        await Promise.all([beforeSide.build(), afterSide.build()]);
        if (cancelled) {
          beforeSide.destroy();
          afterSide.destroy();
          return;
        }
        sides.push(beforeSide, afterSide);

        setStats({
          before: { pages: before.doc.numPages, bytes: before.bytes },
          after: { pages: after.doc.numPages, bytes: after.bytes },
        });
        setReady(true);
      } catch (e) {
        if (cancelled || (e instanceof Error && e.message === 'cancelled')) return;
        setError(
          'Could not load the example PDFs — please close this and try again.',
        );
      }
    })();

    return () => {
      cancelled = true;
      sides.forEach((s) => s.destroy());
      loadTasks.forEach((t) => {
        try {
          void t.destroy();
        } catch {
          // already destroyed
        }
      });
    };
  }, [attempt]);

  const savedPagesPct =
    stats && stats.before.pages > 0
      ? Math.round((1 - stats.after.pages / stats.before.pages) * 100)
      : null;

  return (
    <>
      {stats && savedPagesPct !== null && (
        <div className="flex flex-wrap gap-2">
          <Badge
            className="border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
            variant="outline"
          >
            <Check className="mr-1 h-3.5 w-3.5" /> −{savedPagesPct}% pages
          </Badge>
          <Badge
            className="border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
            variant="outline"
          >
            <Check className="mr-1 h-3.5 w-3.5" /> −~{EXAMPLE_INK_SAVED_PCT}% ink
          </Badge>
          <Badge variant="outline" className="border-white/15 bg-white/5">
            41 slides → {stats.after.pages} bright pages
          </Badge>
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-400/40 text-red-200 hover:bg-red-500/10"
            onClick={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* BEFORE */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Before — original</p>
            <Badge
              variant="outline"
              className="shrink-0 border-white/15 bg-white/5 text-xs"
            >
              {stats
                ? `all ${stats.before.pages} pages · ${formatMB(stats.before.bytes)}`
                : '…'}
            </Badge>
          </div>
          <div className="relative">
            <div
              ref={beforeBox}
              aria-label="Preview of the original lecture PDF — all 41 pages"
              className="max-h-[52vh] space-y-2 overflow-y-auto pr-1 pretty-scroll"
            />
            {!ready && !error && (
              <div className="absolute inset-0 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="aspect-video w-full animate-pulse rounded-md bg-white/[0.06]"
                  />
                ))}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Dark slides — a full page of ink for every slide. Scroll for all 41.
          </p>
        </div>

        {/* AFTER */}
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">After — printified</p>
            <Badge
              variant="outline"
              className="shrink-0 border-emerald-400/30 bg-emerald-500/10 text-xs text-emerald-300"
            >
              {stats
                ? `all ${stats.after.pages} pages · ${formatMB(stats.after.bytes)}`
                : '…'}
            </Badge>
          </div>
          <div className="relative">
            <div
              ref={afterBox}
              aria-label="Preview of the printified PDF — all pages"
              className="max-h-[52vh] space-y-2 overflow-y-auto pr-1 pretty-scroll"
            />
            {!ready && !error && (
              <div className="absolute inset-0 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="aspect-[1/1.414] w-full animate-pulse rounded-md bg-white/[0.06]"
                  />
                ))}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Bright white pages — 3 slides per sheet, numbered, ready to print.
          </p>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          asChild
          className="w-full border-white/15 bg-white/5 sm:w-auto"
        >
          <a href={BEFORE_URL} download={BEFORE_NAME}>
            <FileDown className="mr-2 h-4 w-4" /> Download original
          </a>
        </Button>
        <Button
          asChild
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          <a href={AFTER_URL} download={AFTER_NAME}>
            {ready ? (
              <>
                <FileDown className="mr-2 h-4 w-4" /> Download printified
              </>
            ) : (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…
              </>
            )}
          </a>
        </Button>
      </div>
    </>
  );
}
