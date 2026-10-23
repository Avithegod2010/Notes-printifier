/**
 * filter-client.ts — main-thread bridge to the filter preview Web Worker.
 *
 * `runFilterPreview` ships the raw page pixels (transferred, zero-copy) to
 * the filter worker and resolves with the filtered result + F8 overlay +
 * ink stats. If Workers are unavailable or the worker crashes, it falls
 * back to the identical chain on the main thread (filter-preview-core) so
 * the preview NEVER dead-ends.
 *
 * Transfer note: the pixel buffer ownership MOVES to the worker, so a job
 * that dies inside the worker cannot be retried on the main thread (the
 * bytes are gone). The enhance preview always re-renders the page fresh for
 * the next attempt, so this is self-healing — the retry lands on whichever
 * path is healthy.
 */

import {
  runPreviewChain,
  type PreviewChainResult,
} from './filter-preview-core';
import type { ColorMode, FilterSettings } from './filters';

export interface FilterPreviewResult {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  overlay: { width: number; height: number; pixels: Uint8ClampedArray } | null;
  inkBefore: number;
  inkAfter: number;
  skewAngle: number;
  effectiveMode: ColorMode;
}

type WorkerReply = {
  type: 'done' | 'error';
  id: number;
  message?: string;
  width?: number;
  height?: number;
  afterBuf?: ArrayBuffer;
  overlayBuf?: ArrayBuffer | null;
  overlayWidth?: number | null;
  overlayHeight?: number | null;
  inkBefore?: number;
  inkAfter?: number;
  skewAngle?: number;
  effectiveMode?: ColorMode;
};

interface PendingJob {
  resolve: (r: WorkerReply) => void;
  reject: (e: Error) => void;
}

let sharedWorker: Worker | null = null;
let workerBroken = false;
let nextJobId = 1;
const jobs = new Map<number, PendingJob>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (sharedWorker) return sharedWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    workerBroken = true;
    return null;
  }
  try {
    sharedWorker = new Worker(new URL('./filter-worker.ts', import.meta.url));
    sharedWorker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      jobs.delete(e.data.id);
      job.resolve(e.data);
    };
    sharedWorker.onerror = () => {
      // script failed to load / runtime crash — fail all pending jobs and
      // stop trying (the next preview call takes the main-thread path)
      workerBroken = true;
      for (const [, job] of jobs) job.reject(new Error('preview worker crashed'));
      jobs.clear();
      sharedWorker = null;
    };
    return sharedWorker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function toResult(r: PreviewChainResult): FilterPreviewResult {
  return {
    width: r.width,
    height: r.height,
    pixels: r.pixels,
    overlay:
      r.overlayPixels && r.overlayWidth && r.overlayHeight
        ? { width: r.overlayWidth, height: r.overlayHeight, pixels: r.overlayPixels }
        : null,
    inkBefore: r.inkBefore,
    inkAfter: r.inkAfter,
    skewAngle: r.skewAngle,
    effectiveMode: r.effectiveMode,
  };
}

/**
 * Run the preview chain for one page's raw pixels. `imageData.data.buffer`
 * is TRANSFERRED (the caller must not reuse the ImageData afterwards — the
 * enhance preview always re-renders the page fresh, so this is free).
 */
export async function runFilterPreview(
  imageData: ImageData,
  settings: FilterSettings,
): Promise<FilterPreviewResult> {
  const worker = getWorker();
  if (worker) {
    const id = nextJobId++;
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      jobs.set(id, { resolve, reject });
      // ownership of the pixel buffer moves to the worker (zero copy)
      worker.postMessage(
        {
          op: 'preview',
          id,
          width: imageData.width,
          height: imageData.height,
          buf: imageData.data.buffer,
          settings,
        },
        [imageData.data.buffer as ArrayBuffer],
      );
    }).catch((err) => {
      // the pixel buffer was transferred → detached here, so THIS call can
      // never fall back. Mark the worker broken so the next preview (which
      // re-renders fresh pixels) takes the main-thread path instead.
      if (imageData.data.buffer.byteLength === 0) workerBroken = true;
      throw err instanceof Error ? err : new Error('Preview worker failed');
    });

    if (reply.type === 'error' || !reply.afterBuf) {
      throw new Error(reply.message ?? 'Preview worker failed');
    }

    return {
      width: reply.width ?? imageData.width,
      height: reply.height ?? imageData.height,
      pixels: new Uint8ClampedArray(reply.afterBuf),
      overlay:
        reply.overlayBuf && reply.overlayWidth && reply.overlayHeight
          ? {
              width: reply.overlayWidth,
              height: reply.overlayHeight,
              pixels: new Uint8ClampedArray(reply.overlayBuf),
            }
          : null,
      inkBefore: reply.inkBefore ?? 0,
      inkAfter: reply.inkAfter ?? 0,
      skewAngle: reply.skewAngle ?? 0,
      effectiveMode: reply.effectiveMode ?? 'original',
    };
  }

  // Main-thread fallback (old browsers / worker unavailable).
  const local = runPreviewChain({
    width: imageData.width,
    height: imageData.height,
    pixels: imageData.data,
    settings,
  });
  return toResult(local);
}
