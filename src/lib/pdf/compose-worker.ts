/// <reference lib="webworker" />
/**
 * compose-worker.ts — the processing Web Worker.
 *
 * Runs the ENTIRE pipeline off the main thread: pdf.js parsing/rendering,
 * pixel filters, JPEG encoding and pdf-lib composition, all on
 * OffscreenCanvas. The UI thread stays perfectly responsive — sliders,
 * animations and progress bars keep running at 60fps even while a 60-page
 * deck is being processed.
 *
 * Protocol (with worker-client.ts):
 *   → { op: 'compose' | 'estimate', id, buffers, items, filters, layout }
 *   ← { type: 'progress', id, done, total }
 *   ← { type: 'done', id, result }            (pdfBytes transferred back)
 *   ← { type: 'error', id, message }
 */

import * as pdfjsLib from 'pdfjs-dist';
import {
  composePdfCore,
  estimateCore,
  type ComposeEnv,
  type ComposeItem,
  type CoverSheetData,
  type LayoutSettings,
  type PdfDocLike,
} from './compose-core';
import type { AnyCanvas, FilterSettings } from './filters';
import { PDF_WASM_URL } from './pdfjs';

// pdf.js normally spawns its own worker for parsing. Inside this worker we
// try that first (subworkers are supported everywhere modern); if the
// environment refuses, we fall back to the fake-worker (main-thread-of-worker)
// mode by importing the worker bundle directly.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.mjs`;
let fakeWorkerReady = false;

async function ensureParser(): Promise<void> {
  if (!fakeWorkerReady) return;
  // re-arm fake worker mode after a failure
  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) {
    g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
  }
}

async function loadDocument(data: ArrayBuffer): Promise<PdfDocLike> {
  const copy = new Uint8Array(data.slice(0));
  try {
    return (await pdfjsLib.getDocument({ data: copy, wasmUrl: PDF_WASM_URL }).promise) as unknown as PdfDocLike;
  } catch (err) {
    console.warn('[compose-worker] subworker parse failed, using fake worker', err);
    fakeWorkerReady = true;
    await ensureParser();
    return (await pdfjsLib.getDocument({ data: copy, wasmUrl: PDF_WASM_URL }).promise) as unknown as PdfDocLike;
  }
}

const env: ComposeEnv = {
  createCanvas: (w, h) =>
    new OffscreenCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))),
  loadDocument,
  yield: () => Promise.resolve(),
};

interface WorkerRequest {
  op: 'compose' | 'estimate';
  id: number;
  buffers: Array<{ id: number; data: ArrayBuffer }>;
  items: ComposeItem[];
  filters: FilterSettings;
  layout: LayoutSettings;
  /**
   * LABS text-repaint canvases (OffscreenCanvas only — the client transfers
   * them). Read-only here: draw through composePdfCore, never close/destroy.
   */
  repaintCanvases?: Map<string, AnyCanvas> | null;
  /** Batch cover page strings (already translated on the UI side). */
  coverSheetData?: CoverSheetData | null;
  /** Size-target recompression ceiling for JPEG quality. */
  jpegQualityOverride?: number;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { op, id } = e.data;
  const post = (msg: unknown, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(msg, transfer ?? []);

  try {
    if (op === 'compose') {
      const result = await composePdfCore(env, {
        buffers: e.data.buffers,
        items: e.data.items,
        filters: e.data.filters,
        layout: e.data.layout,
        repaintCanvases: e.data.repaintCanvases ?? null,
        coverSheetData: e.data.coverSheetData ?? null,
        jpegQualityOverride: e.data.jpegQualityOverride,
        onProgress: (done, total) => post({ type: 'progress', id, done, total }),
      });
      post({ type: 'done', id, result }, [result.pdfBytes.buffer as ArrayBuffer]);
    } else if (op === 'estimate') {
      const result = await estimateCore(
        env,
        {
          buffers: e.data.buffers,
          items: e.data.items,
          filters: e.data.filters,
          layout: e.data.layout,
        },
        4,
      );
      post({ type: 'done', id, result });
    }
  } catch (err) {
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Processing failed in worker',
    });
  }
};
