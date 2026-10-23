/// <reference lib="webworker" />
/**
 * filter-worker.ts — the enhance-preview Web Worker.
 *
 * Runs the ENTIRE preview pixel chain off the main thread (raw render →
 * filters → trim → F8 overlay diff → ink stats) on OffscreenCanvas, so
 * dragging the ink-saver / pen-boost sliders on a 200+ page deck never
 * janks the UI. The raw pixels ride in as a transferred ArrayBuffer and the
 * result pixels ride back the same way — zero copies.
 *
 * Protocol:
 *   → { op: 'preview', id, width, height, buf, settings }
 *   ← { type: 'progress'… }                        (not used — single-shot)
 *   ← { type: 'done', id, width, height, afterBuf, overlayBuf?, … }
 *   ← { type: 'error', id, message }
 */

import { runPreviewChain } from './filter-preview-core';
import type { FilterSettings } from './filters';

interface WorkerRequest {
  op: 'preview';
  id: number;
  width: number;
  height: number;
  /** RGBA pixel buffer (transferred — ownership moves to the worker). */
  buf: ArrayBuffer;
  /** Global filters already merged with the page override by the caller. */
  settings: FilterSettings;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { op, id } = e.data;
  const post = (msg: unknown, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(msg, transfer ?? []);

  try {
    if (op === 'preview') {
      const out = runPreviewChain({
        width: e.data.width,
        height: e.data.height,
        pixels: new Uint8ClampedArray(e.data.buf),
        settings: e.data.settings,
      });

      const afterBuf = out.pixels.buffer as ArrayBuffer;
      const transfers: Transferable[] = [afterBuf];
      let overlayBuf: ArrayBuffer | null = null;
      if (out.overlayPixels) {
        overlayBuf = out.overlayPixels.buffer as ArrayBuffer;
        transfers.push(overlayBuf);
      }

      post(
        {
          type: 'done',
          id,
          width: out.width,
          height: out.height,
          afterBuf,
          overlayBuf,
          overlayWidth: out.overlayWidth,
          overlayHeight: out.overlayHeight,
          inkBefore: out.inkBefore,
          inkAfter: out.inkAfter,
          skewAngle: out.skewAngle,
          effectiveMode: out.effectiveMode,
        },
        transfers,
      );
    }
  } catch (err) {
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : 'Preview failed in worker',
    });
  }
};
