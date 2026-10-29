/**
 * compose.ts — public composition API.
 *
 * `composePdf` routes through the processing Web Worker (UI stays fully
 * responsive, no jank even on big decks) and transparently falls back to the
 * main-thread pipeline when Workers/OffscreenCanvas are unavailable or the
 * worker crashes. Both paths run the identical composePdfCore pipeline.
 */

import {
  composePdfCore,
  estimateCore,
  type ComposeCoreResult,
  type ComposeEnv,
  type ComposeOptions,
  type EstimateResult,
  type PdfDocLike,
} from './compose-core';
import { loadPdfDocument } from './pdfjs';

export type {
  ComposeItem,
  ComposeOptions,
  CoverSheetData,
  LayoutSettings,
  PageSizeOpt,
  Placement,
  QualityOpt,
} from './compose-core';
export {
  bookletOutputPages,
  buildBookletItems,
  defaultLayout,
  estimateOutputPages,
  jpegForDpi,
  resolveQuality,
  DPI_MIN,
  DPI_MAX,
  QUALITY,
} from './compose-core';

export interface ComposeResult extends ComposeCoreResult {
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

const mainEnv: ComposeEnv = {
  createCanvas: (w, h) => {
    const canvas = document.createElement('canvas');
    // floor, not ceil: the canvas must never exceed the viewport rect pdf.js
    // paints — an unpainted overflow line shows as a hairline artifact (and
    // inverts to black in the composed output).
    canvas.width = Math.max(1, Math.floor(w));
    canvas.height = Math.max(1, Math.floor(h));
    return canvas;
  },
  loadDocument: (data) =>
    loadPdfDocument(data) as unknown as Promise<PdfDocLike>,
  yield: () => new Promise((r) => setTimeout(r, 0)),
};

/** Run the pipeline on the main thread (fallback). */
async function composePdfMainThread(o: ComposeOptions): Promise<ComposeResult> {
  const core = await composePdfCore(mainEnv, o);
  return { ...core, blob: new Blob([core.pdfBytes as BlobPart], { type: 'application/pdf' }) };
}

async function estimateMainThread(
  o: Omit<ComposeOptions, 'onProgress'>,
): Promise<EstimateResult> {
  return estimateCore(mainEnv, o);
}

// ---------------------------------------------------------------------------
// Worker bridge
// ---------------------------------------------------------------------------

type WorkerReply =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; result: ComposeCoreResult | EstimateResult }
  | { type: 'error'; id: number; message: string };

interface PendingJob {
  resolve: (r: ComposeCoreResult | EstimateResult) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
}

let sharedWorker: Worker | null = null;
let workerBroken = false;
const jobs = new Map<number, PendingJob>();
let nextJobId = 1;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (sharedWorker) return sharedWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    workerBroken = true;
    return null;
  }
  try {
    sharedWorker = new Worker(new URL('./compose-worker.ts', import.meta.url));
    sharedWorker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      const job = jobs.get(msg.id);
      if (!job) return;
      if (msg.type === 'progress') {
        job.onProgress?.(msg.done, msg.total);
      } else {
        jobs.delete(msg.id);
        if (msg.type === 'done') job.resolve(msg.result);
        else job.reject(new Error(msg.message));
      }
    };
    sharedWorker.onerror = () => {
      // script failed to load / runtime crash — fail all jobs and stop trying
      workerBroken = true;
      for (const [, job] of jobs) job.reject(new Error('worker crashed'));
      jobs.clear();
      sharedWorker = null;
    };
    return sharedWorker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function runWorkerOp(
  op: string,
  payload: Record<string, unknown>,
  transfer: Transferable[],
  onProgress?: (done: number, total: number) => void,
): Promise<ComposeCoreResult | EstimateResult> {
  const worker = getWorker();
  if (!worker) return Promise.reject(new Error('worker unavailable'));
  const id = nextJobId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    worker.postMessage({ op, id, ...payload }, transfer);
  });
}

/**
 * Compose via the worker when possible; fall back to the main thread on any
 * failure so processing NEVER dead-ends.
 *
 * Text-repaint canvases are handled specially: OffscreenCanvas instances are
 * transferable and ride along in the worker message's transfer list; DOM
 * canvases are NOT transferable, so if any repaint canvas is a DOM canvas the
 * worker is skipped for this run and the main-thread pipeline is used.
 */
export async function composePdf(o: ComposeOptions): Promise<ComposeResult> {
  const repaintList = o.repaintCanvases ? Array.from(o.repaintCanvases.values()) : [];
  const repaintTransferrable =
    repaintList.length === 0 ||
    (typeof OffscreenCanvas !== 'undefined' &&
      repaintList.every((c) => c instanceof OffscreenCanvas));

  if (o.buffers.length > 0 && repaintTransferrable) {
    try {
      // slice(): doc buffers must stay intact for previews / re-runs, so the
      // worker gets private copies that we transfer (zero extra copies).
      const copies = o.buffers.map((b) => b.data.slice(0));
      const transfer: Transferable[] = [
        ...(copies as unknown as Transferable[]),
        ...(repaintList as unknown as Transferable[]),
      ];
      const result = (await runWorkerOp(
        'compose',
        {
          buffers: o.buffers.map((b, i) => ({ id: b.id, data: copies[i] })),
          items: o.items,
          filters: o.filters,
          layout: o.layout,
          repaintCanvases: o.repaintCanvases ?? null,
          coverSheetData: o.coverSheetData ?? null,
          jpegQualityOverride: o.jpegQualityOverride,
          recipeQrPng: o.recipeQrPng ?? null,
        },
        transfer,
        o.onProgress,
      )) as ComposeCoreResult;

      // Blank-render fallback (the "whole deck printed blank" bug): inside
      // the worker pdf.js can silently resolve a render with NOTHING drawn
      // (nested-worker wasm/JPX races on some mobile browsers) while the
      // SAME page renders perfectly on the main thread — that is exactly
      // what the Enhance/Layout previews showed. A worker pass that reports
      // blank cells is therefore not trustworthy: re-run the whole compose
      // on the main thread and keep whichever pass rendered more pages.
      // Genuinely blank source pages re-blank identically in both passes
      // and cost one extra pass only when a blank was actually seen.
      if (result.blankSkipped > 0) {
        console.warn(
          `[compose] worker pass rendered ${result.blankSkipped} blank page(s) — re-running on the main thread to compare`,
        );
        try {
          const mainResult = await composePdfMainThread({
            ...o,
            // OffscreenCanvas repaint buffers were TRANSFERRED into the
            // worker (neutered on this thread) — a detached canvas cannot
            // be redrawn, so degrade to plain page rendering rather than
            // risk a second blank output (same trade as the catch path).
            repaintCanvases: repaintList.length > 0 ? null : o.repaintCanvases,
          });
          if (mainResult.blankSkipped <= result.blankSkipped) {
            return {
              ...mainResult,
              blob: new Blob([mainResult.pdfBytes as BlobPart], {
                type: 'application/pdf',
              }),
            };
          }
          // The worker result won — but a pass that blanks most of a deck
          // leaves poisoned state behind (dead nested pdf.js worker, broken
          // wasm cache). Terminate it so the NEXT job starts fresh instead
          // of inheriting the failure.
          try {
            sharedWorker?.terminate();
          } catch {
            // already gone
          }
          sharedWorker = null;
        } catch (fallbackErr) {
          console.warn('Main-thread fallback compose failed.', fallbackErr);
        }
      }

      return {
        ...result,
        blob: new Blob([result.pdfBytes as BlobPart], { type: 'application/pdf' }),
      };
    } catch (err) {
      if (!workerBroken) {
        console.warn('Worker compose failed — falling back to main thread.', err);
      }
      if (repaintList.length > 0) {
        // The worker attempt may already have TRANSFERRED (neutered) the
        // repaint canvases — a detached OffscreenCanvas cannot be redrawn.
        // Degrade gracefully: fall back to plain page rendering (repaint off)
        // rather than risk blank repainted pages.
        return composePdfMainThread({ ...o, repaintCanvases: null });
      }
    }
  }
  return composePdfMainThread(o);
}

/** Fast size/ink estimate for the Layout screen (worker, else main thread). */
export async function estimateOutput(
  o: Omit<ComposeOptions, 'onProgress'>,
): Promise<EstimateResult | null> {
  try {
    if (o.buffers.length > 0) {
      const copies = o.buffers.map((b) => b.data.slice(0));
      const result = (await runWorkerOp(
        'estimate',
        {
          buffers: o.buffers.map((b, i) => ({ id: b.id, data: copies[i] })),
          items: o.items,
          filters: o.filters,
          layout: o.layout,
        },
        copies as unknown as Transferable[],
      )) as EstimateResult;
      return result;
    }
  } catch (err) {
    if (!workerBroken) console.warn('Worker estimate failed — using main thread.', err);
  }
  try {
    return await estimateMainThread(o);
  } catch {
    return null;
  }
}

