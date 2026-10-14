/**
 * ocr.ts — optional "searchable PDF" pass.
 *
 * The composed output is an image-based PDF (that's what makes the ink
 * savings possible). When the user enables OCR, we run Tesseract.js
 * (fully self-hosted in /public/tesseract — works offline, no CDN) on every
 * source slide, then draw an INVISIBLE text layer (opacity 0) exactly under
 * each slide's placement rect, so:
 *   - Ctrl+F / phone search find text in the output PDF
 *   - text can be selected & copied
 *   - printing is unaffected (invisible text lays down no ink)
 *
 * Word boxes are stored as FRACTIONS of the source slide's dimensions, so
 * they map correctly onto the final (possibly trimmed & rescaled) placement.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadPdfDocument } from './pdfjs';
import type { ComposeItem, Placement } from './compose-core';

export interface OcrWord {
  text: string;
  /** bounding box as fractions of the slide width/height (origin: top-left) */
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
}

export interface OcrKey {
  docId: number;
  pageNumber: number;
  rotation: number;
}

const OCR_RENDER_WIDTH = 1100; // px — good accuracy/speed trade-off for OCR
const MIN_WORD_CONFIDENCE = 35;
const MAX_OCR_SLIDES = 120; // hard cap — beyond this the wait isn't worth it

/** WinAnsi-safe text (Helvetica standard font) — drop anything else. */
function sanitize(text: string): string {
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '').trim();
}

export function ocrKeyString(k: OcrKey): string {
  return `${k.docId}:${k.pageNumber}:${k.rotation}`;
}

export function countOcrSlides(items: ComposeItem[]): number {
  return new Set(
    items
      .filter((i) => !i.blank)
      .map((i) => ocrKeyString(i)),
  ).size;
}

/**
 * OCR every unique source slide used by the composition.
 * Returns word boxes keyed by docId:pageNumber:rotation.
 */
export async function ocrComposeItems(
  buffers: Array<{ id: number; data: ArrayBuffer }>,
  items: ComposeItem[],
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<Map<string, OcrWord[]>> {
  const unique = new Map<string, OcrKey>();
  for (const item of items) {
    if (item.blank) continue;
    const key = `${item.docId}:${item.pageNumber}:${item.rotation}`;
    if (!unique.has(key)) {
      unique.set(key, { docId: item.docId, pageNumber: item.pageNumber, rotation: item.rotation });
    }
  }
  const total = unique.size;
  const results = new Map<string, OcrWord[]>();
  if (total === 0) return results;
  if (total > MAX_OCR_SLIDES) {
    throw new Error(
      `OCR is limited to ${MAX_OCR_SLIDES} pages per job — deselect a few pages or turn OCR off.`,
    );
  }

  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract',
    langPath: '/tesseract',
    gzip: true,
    errorHandler: (e) => console.warn('[ocr]', e),
  });

  try {
    const docs = new Map<number, Awaited<ReturnType<typeof loadPdfDocument>>>();
    const buffersById = new Map(buffers.map((b) => [b.id, b.data]));

    let done = 0;
    for (const [key, k] of unique) {
      if (isCancelled?.()) throw new Error('OCR cancelled');
      let doc = docs.get(k.docId);
      if (!doc) {
        const buf = buffersById.get(k.docId);
        if (!buf) throw new Error('Source file is no longer available for OCR');
        doc = await loadPdfDocument(buf);
        docs.set(k.docId, doc);
      }

      const page = await doc.getPage(k.pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, OCR_RENDER_WIDTH / base.width);
      const rotation = (base.rotation + k.rotation) % 360;
      const viewport = page.getViewport({ scale, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable for OCR');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();

      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const w of line.words ?? []) {
              if (w.confidence < MIN_WORD_CONFIDENCE) continue;
              const text = sanitize(w.text ?? '');
              if (!text) continue;
              const fx0 = w.bbox.x0 / canvas.width;
              const fx1 = w.bbox.x1 / canvas.width;
              const fy0 = w.bbox.y0 / canvas.height;
              const fy1 = w.bbox.y1 / canvas.height;
              if (fx1 - fx0 <= 0.001 || fy1 - fy0 <= 0.002) continue;
              words.push({ text, fx0, fy0, fx1, fy1 });
            }
          }
        }
      }
      results.set(key, words);

      done++;
      onProgress?.(done, total);
    }
  } finally {
    await worker.terminate();
  }

  return results;
}

/**
 * Draw the invisible text layer onto the composed PDF bytes.
 * Maps OCR word fractions through each slide's final placement rect.
 */
export async function addOcrTextLayer(
  pdfBytes: Uint8Array,
  items: ComposeItem[],
  placements: Placement[],
  wordsByKey: Map<string, OcrWord[]>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const transparent = rgb(0, 0, 0);

  for (const p of placements) {
    const item = items[p.itemIndex];
    if (!item) continue;
    const key = ocrKeyString(item);
    const words = wordsByKey.get(key);
    if (!words || words.length === 0) continue;
    const page = doc.getPage(p.outPage - 1);

    for (const w of words) {
      const text = w.text;
      const fontSize = (w.fy1 - w.fy0) * p.h;
      if (fontSize < 3 || fontSize > p.h * 0.6) continue; // noise guard
      const x = p.x + w.fx0 * p.w;
      // fy is measured from the TOP of the slide; PDF origin is bottom-left
      const y = p.y + (1 - w.fy1) * p.h;
      try {
        page.drawText(text, {
          x,
          y,
          size: Math.min(fontSize, 42),
          font,
          color: transparent,
          opacity: 0,
        });
      } catch {
        // single-word failures (encoding edge cases) must not kill the pass
      }
    }
  }

  return doc.save();
}
