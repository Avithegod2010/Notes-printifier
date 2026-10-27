/**
 * render-guard.ts — blank-render detection shared by every pdf.js render path.
 *
 * WHY THIS EXISTS (the "full black page" bug): pdf.js can silently come back
 * with a blank page — a JPEG2000/JBIG2 wasm decode failure, a lost worker
 * race or an OOM'd canvas all resolve the render promise with nothing drawn.
 * The canvas was pre-filled white, the pipeline then INVERTS it, and the
 * output cell becomes a solid-black ink bomb (verified: every slide image in
 * the user's black output PDF was a 100% black JPEG).
 *
 * A blank-ish page must therefore NEVER be inverted. White→white is harmless;
 * white→black prints a full-coverage black rectangle.
 */

import type { AnyCanvas, AnyCtx } from './filters';

/**
 * A page at or below this sampled ink fraction counts as "blank-ish".
 * 0.5% ink = an essentially empty page; inverting it would print an
 * almost fully-black sheet. Real content pages measure 2%+ easily.
 */
export const BLANK_INK_FRACTION = 0.005;

/** Near-white luminance threshold for the ink count (matches trimMargins). */
const INK_LUM = 247;

/**
 * Sampled fraction of non-near-white pixels (0–1). Stride sampling keeps
 * this at ~1/11 of a full getImageData pass — negligible per page.
 */
export function inkFractionOf(canvas: AnyCanvas): number {
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  if (!ctx) return 1; // can't measure — assume content (never skip filters)
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2) return 1;
  let d: Uint8ClampedArray;
  try {
    d = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return 1; // tainted/unreadable — assume content
  }
  let inked = 0;
  let total = 0;
  for (let i = 0; i < d.length; i += 4 * 11) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < INK_LUM) inked++;
    total++;
  }
  return total === 0 ? 1 : inked / total;
}

/**
 * True when the rendered canvas is blank-ish (render failure or an empty
 * page) — callers must NOT invert it and should count it as skipped.
 */
export function isBlankishRender(canvas: AnyCanvas): boolean {
  return inkFractionOf(canvas) <= BLANK_INK_FRACTION;
}
