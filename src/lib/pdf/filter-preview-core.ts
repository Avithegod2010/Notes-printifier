/**
 * filter-preview-core.ts — the enhance-preview pixel chain, worker-safe.
 *
 * This is the EXACT same chain the final pipeline runs per page:
 *   resolve auto → (deskew estimate) → whiteouts → filters → header trim →
 *   margin trim, plus the F8 erased-pixels overlay diff and before/after ink
 * measurements. It runs inside the filter Web Worker (OffscreenCanvas) AND on
 * the main thread as the fallback for browsers without Workers — same code,
 * same results, no DOM required.
 */

import {
  buildErasedOverlayPixels,
  estimateDeskewForPage,
  inkCoverage,
  preparePageCanvas,
  resolveColorMode,
  trimCanvasMargins,
  type AnyCanvas,
  type AnyCtx,
  type ColorMode,
  type FilterSettings,
} from './filters';

export interface PreviewChainInput {
  width: number;
  height: number;
  /** RGBA pixels of the RAW page render (unfiltered). */
  pixels: Uint8ClampedArray;
  /** Global filters ALREADY merged with the page's override by the caller. */
  settings: FilterSettings;
}

export interface PreviewChainResult {
  width: number;
  height: number;
  /** RGBA pixels of the filtered (and possibly trimmed) result. */
  pixels: Uint8ClampedArray;
  /** F8 overlay dimensions + pixels (null = nothing erased / diff failed). */
  overlayWidth: number | null;
  overlayHeight: number | null;
  overlayPixels: Uint8ClampedArray | null;
  /** Ink coverage of the raw vs. filtered render (0–1 fractions). */
  inkBefore: number;
  inkAfter: number;
  /** Deskew angle measured on the raw render (degrees; 0 = off/straight). */
  skewAngle: number;
  /** What 'auto' resolved to for THIS page (badge + stats). */
  effectiveMode: ColorMode;
}

/** Worker-safe canvas factory (OffscreenCanvas when available). */
function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/**
 * ImageData constructor that accepts a plain Uint8ClampedArray view — used
 * by the worker AND the enhance preview's paint step (TS libs type the
 * ImageDataArray parameter stricter than our transferred buffers).
 */
export function makeImageData(
  px: Uint8ClampedArray,
  w: number,
  h: number,
): ImageData {
  return new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, w, h);
}

/**
 * Run the full preview chain on raw page pixels. Synchronous on purpose —
 * inside the worker that is fine (it never blocks the UI thread); the
 * main-thread fallback accepts the same brief block the old code had.
 */
export function runPreviewChain(req: PreviewChainInput): PreviewChainResult {
  const canvas = makeCanvas(req.width, req.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  if (!ctx) throw new Error('Canvas 2D context unavailable for preview');

  // Zero-copy wrap: `pixels` is a view over a transferred ArrayBuffer.
  ctx.putImageData(makeImageData(req.pixels, req.width, req.height), 0, 0);

  // resolve 'auto' once so the preview shows the page's actual treatment
  const effMode = resolveColorMode(canvas, req.settings.colorMode);
  const skewAngle = req.settings.deskew ? estimateDeskewForPage(canvas) : 0;
  // Ink is measured BEFORE trimming: cropping white margins raises the
  // dark-pixel fraction without saving ink — trim saves paper instead.
  const inkBefore = inkCoverage(req.pixels);

  // deskew → filters — the same chain the final pipeline runs (trim is
  // applied separately below so ink can be measured pre-trim)
  const work = preparePageCanvas(canvas, { ...req.settings, trimMargins: false }, effMode);
  const workCtx = work.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  const inkAfter = workCtx
    ? inkCoverage(workCtx.getImageData(0, 0, work.width, work.height).data)
    : inkBefore;

  let final = work;
  if (req.settings.trimMargins) {
    const trimmed = trimCanvasMargins(work);
    if (trimmed !== work) final = trimmed;
  }

  // F8 overlay: normalize the raw render onto the displayed result's box
  // (trim may have changed the aspect), then diff pixel-by-pixel.
  let overlayPixels: Uint8ClampedArray | null = null;
  let overlayWidth: number | null = null;
  let overlayHeight: number | null = null;
  try {
    const norm = makeCanvas(final.width, final.height);
    const nctx = norm.getContext('2d') as AnyCtx | null;
    if (nctx) {
      nctx.drawImage(canvas as CanvasImageSource, 0, 0, final.width, final.height);
      const overlay = buildErasedOverlayPixels(norm, final);
      if (overlay) {
        overlayPixels = overlay.data;
        overlayWidth = overlay.width;
        overlayHeight = overlay.height;
      }
    }
  } catch {
    overlayPixels = null;
  }

  const finalCtx = final.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  if (!finalCtx) throw new Error('Canvas 2D context unavailable for preview');
  const finalImg = finalCtx.getImageData(0, 0, final.width, final.height);

  return {
    width: final.width,
    height: final.height,
    pixels: finalImg.data,
    overlayWidth,
    overlayHeight,
    overlayPixels,
    inkBefore,
    inkAfter,
    skewAngle,
    effectiveMode: effMode,
  };
}
