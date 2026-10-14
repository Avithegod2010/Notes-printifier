/**
 * compose-core.ts — the shared PDF composition pipeline.
 *
 * Runs in TWO contexts with the exact same code:
 *  - main thread (env.createCanvas → <canvas>): fallback for old browsers
 *  - inside a Web Worker (env.createCanvas → OffscreenCanvas): keeps the UI
 *    fully responsive during processing
 *
 * The pipeline:
 *   render page → measure (smart invert + ink stats) → filters → trim →
 *   JPEG → place into rows×cols grid → pdf-lib A4 output
 *
 * It also records every slide's final placement rectangle, which the OCR
 * text-layer pass maps word bounding boxes onto.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import {
  applyFilters,
  inkCoverage,
  resolveColorMode,
  trimCanvasMargins,
  type AnyCanvas,
  type AnyCtx,
  type FilterSettings,
} from './filters';

export type PageSizeOpt = 'a4' | 'letter' | 'original';
export type QualityOpt = 'low' | 'medium' | 'high';

export interface LayoutSettings {
  pageSize: PageSizeOpt;
  orientation: 'portrait' | 'landscape';
  rows: number;
  cols: number;
  separators: boolean;
  pageNumbers: boolean;
  quality: QualityOpt;
  /** Booklet arrangement: 2-up landscape, saddle-stitch page order. */
  booklet: boolean;
  /** Duplex helper: append one blank page when the sheet count is odd. */
  duplexPad: boolean;
  /** Optional small label printed bottom-left of every sheet. */
  footerLabel?: string;
}

export const defaultLayout: LayoutSettings = {
  pageSize: 'a4',
  orientation: 'portrait',
  rows: 3,
  cols: 1,
  separators: true,
  pageNumbers: true,
  quality: 'medium',
  booklet: false,
  duplexPad: false,
};

export interface ComposeItem {
  docId: number;
  pageNumber: number; // 1-based within its source document
  rotation: number; // user rotation 0/90/180/270
  /** Renders an intentional empty (white) cell — used for booklet padding. */
  blank?: boolean;
}

export interface ComposeOptions {
  /** Raw PDF bytes, each tagged with the docId it belongs to. */
  buffers: Array<{ id: number; data: ArrayBuffer }>;
  /** Selected pages, already in the desired order. */
  items: ComposeItem[];
  filters: FilterSettings;
  layout: LayoutSettings;
  onProgress?: (done: number, total: number) => void;
}

export interface Placement {
  /** Index into ComposeOptions.items (the non-blank slide this rect belongs to). */
  itemIndex: number;
  /** Output page number (1-based). */
  outPage: number;
  /** Rect in PDF points, origin bottom-left of the output page. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComposeCoreResult {
  pdfBytes: Uint8Array;
  outputPages: number;
  /** Estimated % of ink saved vs. printing originals (sampled). */
  inkSavedPct: number;
  /** Estimated % ink coverage of the ORIGINAL pages (sampled). */
  beforeInkPct: number;
  placements: Placement[];
  /** How many pages the smart (auto) mode decided to invert. */
  autoInverted: number;
}

export const QUALITY: Record<QualityOpt, { dpi: number; jpeg: number }> = {
  low: { dpi: 96, jpeg: 0.5 },
  medium: { dpi: 150, jpeg: 0.68 },
  high: { dpi: 210, jpeg: 0.85 },
};

export const PAGE_SIZES: Record<Exclude<PageSizeOpt, 'original'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export function estimateOutputPages(pageCount: number, layout: LayoutSettings): number {
  if (layout.booklet) return bookletOutputPages(pageCount);
  const perPage = Math.max(1, layout.rows * layout.cols);
  return Math.max(1, Math.ceil(pageCount / perPage));
}

/** Booklet output = one landscape sheet side per 2 booklet pages, padded to 4. */
export function bookletOutputPages(count: number): number {
  if (count <= 0) return 0;
  const padded = Math.ceil(count / 4) * 4;
  return padded / 2;
}

/**
 * Saddle-stitch order for a fold-in-half booklet: sheet fronts/backs arranged
 * so that printing 2-up landscape, duplex (flip on short edge), then folding
 * once yields a correctly ordered booklet. Pads to a multiple of 4 with blank
 * cells at the END of the booklet.
 */
export function buildBookletItems(items: ComposeItem[]): ComposeItem[] {
  const total = items.length;
  if (total === 0) return [];
  const padded = Math.ceil(total / 4) * 4;
  const out: ComposeItem[] = [];
  for (let j = 1; j <= padded / 2; j++) {
    let left: number;
    let right: number;
    if (j % 2 === 1) {
      const m = (j + 1) / 2; // sheet number, front side
      left = padded - 2 * m + 2;
      right = 2 * m - 1;
    } else {
      const m = j / 2; // sheet number, back side
      left = 2 * m;
      right = padded - 2 * m + 1;
    }
    for (const p of [left, right]) {
      out.push(
        p <= total
          ? items[p - 1]
          : { docId: 0, pageNumber: 0, rotation: 0, blank: true },
      );
    }
  }
  return out;
}

/** Minimal environment the core needs from its host context. */
export interface ComposeEnv {
  createCanvas: (w: number, h: number) => AnyCanvas;
  /** pdf.js loader — differs between main thread and worker. */
  loadDocument: (data: ArrayBuffer) => Promise<PdfDocLike>;
  /** Yield to the host event loop (keeps progress UI responsive). */
  yield: () => Promise<void>;
}

/** The slice of pdf.js a page object must expose for the pipeline. */
export interface PdfPageLike {
  getViewport: (p: { scale: number; rotation?: number }) => {
    width: number;
    height: number;
    rotation: number;
  };
  render: (p: { canvasContext: AnyCtx; viewport: unknown }) => { promise: Promise<void> };
  cleanup: () => void;
}

export interface PdfDocLike {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
}

/**
 * Build the print-optimized PDF: every selected page is rasterized,
 * filtered (ink saving), then placed into an rows x cols grid.
 */
export async function composePdfCore(env: ComposeEnv, o: ComposeOptions): Promise<ComposeCoreResult> {
  if (o.items.length === 0) throw new Error('No pages selected');

  // Documents keyed by docId — ComposeItem.docId refers to these ids, NOT to
  // array positions. (Indexing positionally used to crash with
  // "undefined is not an object (evaluating 'src.getPage')" whenever the first
  // doc's id did not match its array index.)
  const srcDocs = new Map<number, PdfDocLike>();
  await Promise.all(
    o.buffers.map(async (b) => {
      srcDocs.set(b.id, await env.loadDocument(b.data));
    }),
  );

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  // ---- output page geometry -------------------------------------------------
  let pw = PAGE_SIZES.a4[0];
  let ph = PAGE_SIZES.a4[1];
  if (o.layout.pageSize === 'letter') {
    pw = PAGE_SIZES.letter[0];
    ph = PAGE_SIZES.letter[1];
  } else if (o.layout.pageSize === 'original') {
    const first = o.items[0];
    const p = await srcDocs.get(first.docId)!.getPage(first.pageNumber);
    const vp = p.getViewport({ scale: 1 });
    pw = vp.width;
    ph = vp.height;
  }
  if (o.layout.orientation === 'landscape') {
    const t = pw;
    pw = ph;
    ph = t;
  }

  const rows = Math.max(1, o.layout.rows);
  const cols = Math.max(1, o.layout.cols);
  const perPage = rows * cols;
  const marginX = 18;
  const marginTop = 18;
  const marginBottom = o.layout.pageNumbers ? 34 : 18;
  const gap = 10;
  const cellW = (pw - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (ph - marginTop - marginBottom - gap * (rows - 1)) / rows;

  const { dpi, jpeg } = QUALITY[o.layout.quality];
  // Pure neutral grays — a blue-tinted separator (0.72,0.72,0.76) printed as a
  // faint blue line, which users read as a leftover "blue mark".
  const lineColor = rgb(0.75, 0.75, 0.75);
  const textColor = rgb(0.45, 0.45, 0.45);

  // ---- decorations (separators + page number) ------------------------------
  const finishPage = (page: PDFPage, occupied: boolean[], pageNumber: number) => {
    if (o.layout.separators && perPage > 1) {
      // horizontal boundaries (between row r and r+1)
      for (let r = 0; r < rows - 1; r++) {
        let any = false;
        for (let c = 0; c < cols; c++) {
          if (occupied[r * cols + c] || occupied[(r + 1) * cols + c]) {
            any = true;
            break;
          }
        }
        if (!any) continue;
        const y = ph - marginTop - r * (cellH + gap) - cellH - gap / 2;
        page.drawLine({
          start: { x: marginX, y },
          end: { x: pw - marginX, y },
          thickness: 0.7,
          color: lineColor,
        });
      }
      // vertical boundaries (between col c and c+1), only across occupied rows
      for (let c = 0; c < cols - 1; c++) {
        let runStart = -1;
        for (let r = 0; r <= rows; r++) {
          const has =
            r < rows && (occupied[r * cols + c] || occupied[r * cols + c + 1]);
          if (has && runStart < 0) runStart = r;
          if (!has && runStart >= 0) {
            const yTop = ph - marginTop - runStart * (cellH + gap);
            const yBot = ph - marginTop - r * (cellH + gap) + gap;
            const x = marginX + (c + 1) * cellW + c * gap + gap / 2;
            page.drawLine({
              start: { x, y: yBot },
              end: { x, y: yTop },
              thickness: 0.7,
              color: lineColor,
            });
            runStart = -1;
          }
        }
      }
    }
    if (o.layout.pageNumbers) {
      const text = String(pageNumber);
      const size = 9;
      const tw = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: (pw - tw) / 2,
        y: 12,
        size,
        font,
        color: textColor,
      });
    }
    if (o.layout.footerLabel && o.layout.footerLabel.trim()) {
      const label = o.layout.footerLabel.trim().slice(0, 60);
      page.drawText(label, {
        x: marginX,
        y: 12,
        size: 8,
        font,
        color: textColor,
      });
    }
  };

  // ---- main pass ------------------------------------------------------------
  let inkSavedSum = 0;
  let inkSamples = 0;
  let inkBeforeSum = 0;
  let autoInverted = 0;
  const placements: Placement[] = [];
  const chunks: ComposeItem[][] = [];
  for (let i = 0; i < o.items.length; i += perPage) {
    chunks.push(o.items.slice(i, i + perPage));
  }
  // Duplex helper: one trailing blank sheet so back sides line up when the
  // file is printed double-sided (booklet mode already pads to a multiple
  // of 4, so it never needs this).
  if (o.layout.duplexPad && !o.layout.booklet && chunks.length % 2 === 1) {
    chunks.push([]);
  }

  let done = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const page = out.addPage([pw, ph]);
    const occupied: boolean[] = new Array(perPage).fill(false);

    for (let local = 0; local < chunk.length; local++) {
      const item = chunk[local];
      occupied[local] = true;

      // booklet padding cell — intentionally empty
      if (item.blank) {
        done++;
        o.onProgress?.(done, o.items.length);
        continue;
      }
      const itemIndex = ci * perPage + local;

      const src = srcDocs.get(item.docId);
      if (!src) {
        throw new Error(
          'Source file is no longer available — please go back and re-upload it.',
        );
      }
      const pdfPage = await src.getPage(item.pageNumber);
      const base = pdfPage.getViewport({ scale: 1 });
      const rotation = (base.rotation + item.rotation) % 360;

      // render at just enough pixels for the cell at the chosen dpi.
      // NOTE: Math.floor, NOT ceil — the canvas must never be larger than the
      // viewport rect pdf.js actually paints. With ceil, the fractional
      // overflow row/column stayed unpainted (white) and inversion turned it
      // into a pure-black hairline frame around every slide.
      const targetPxW = (cellW * dpi) / 72;
      const scale = Math.min(4, Math.max(0.3, targetPxW / base.width));
      const viewport = pdfPage.getViewport({ scale, rotation });

      const canvas = env.createCanvas(
        Math.max(1, Math.floor(viewport.width)),
        Math.max(1, Math.floor(viewport.height)),
      );
      const ctx = canvas.getContext('2d', {
        willReadFrequently: true,
      }) as AnyCtx | null;
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;

      // smart per-page invert decision (before any filtering)
      const effMode = resolveColorMode(canvas, o.filters.colorMode);
      if (o.filters.colorMode === 'auto' && effMode === 'invert') autoInverted++;

      // ink estimate on the first few pages only (cheap)
      let before = 0;
      if (inkSamples < 6) {
        before = inkCoverage(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      }

      applyFilters(canvas, o.filters, effMode);
      let finalCanvas: AnyCanvas = canvas;
      if (o.filters.trimMargins) {
        finalCanvas = trimCanvasMargins(canvas);
      }

      if (inkSamples < 6 && before > 0.03) {
        const afterCtx = finalCanvas.getContext('2d', {
          willReadFrequently: true,
        }) as AnyCtx;
        const after = inkCoverage(afterCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height).data);
        inkBeforeSum += before;
        inkSavedSum += Math.max(0, (before - after) / before);
        inkSamples++;
      }

      const bytes = await canvasToJpegBytes(finalCanvas, jpeg);
      const img = await out.embedJpg(bytes);

      const s = Math.min(cellW / img.width, cellH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      const col = local % cols;
      const row = Math.floor(local / cols);
      const x = marginX + col * (cellW + gap) + (cellW - w) / 2;
      const y =
        ph - marginTop - row * (cellH + gap) - cellH + (cellH - h) / 2;
      page.drawImage(img, { x, y, width: w, height: h });
      placements.push({ itemIndex, outPage: ci + 1, x, y, w, h });

      pdfPage.cleanup();

      done++;
      o.onProgress?.(done, o.items.length);
      // yield to the host loop so the progress UI stays responsive
      await env.yield();
    }

    finishPage(page, occupied, ci + 1);
  }

  const pdfBytes = await out.save();
  const inkSavedPct = inkSamples
    ? Math.min(95, Math.round((inkSavedSum / inkSamples) * 100))
    : 0;
  const beforeInkPct = inkSamples
    ? Math.min(100, Math.round((inkBeforeSum / inkSamples) * 100))
    : 0;

  return { pdfBytes, outputPages: chunks.length, inkSavedPct, beforeInkPct, placements, autoInverted };
}

/**
 * Encode a canvas as JPEG bytes. OffscreenCanvas uses convertToBlob,
 * HTMLCanvasElement uses toBlob.
 */
export async function canvasToJpegBytes(
  canvas: AnyCanvas,
  quality: number,
): Promise<Uint8Array> {
  let blob: Blob | null = null;
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } else {
    blob = await new Promise<Blob | null>((resolve) =>
      (canvas as HTMLCanvasElement).toBlob(resolve, 'image/jpeg', quality),
    );
  }
  if (!blob) throw new Error('Failed to encode page image');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pre-filled white canvas — shared by preview paths. */
export function makeWhiteCanvas(env: ComposeEnv, w: number, h: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  const canvas = env.createCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyCtx;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

// ---------------------------------------------------------------------------
// Estimator — quick sample-based size/ink forecast for the Layout screen.
// ---------------------------------------------------------------------------

export interface EstimateResult {
  outputPages: number;
  estBytes: number;
  /** Ink saved % measured on the sampled pages. */
  inkSavedPct: number;
  beforeInkPct: number;
  sampled: number;
}

/**
 * Sample up to `sampleCount` pages spread across the selection, run them
 * through the real filter pipeline at the real DPI, and extrapolate the
 * final file size + ink savings. ~4 renders instead of ~40.
 */
export async function estimateCore(
  env: ComposeEnv,
  o: Omit<ComposeOptions, 'onProgress'>,
  sampleCount = 4,
): Promise<EstimateResult> {
  const { buffers, items, filters, layout } = o;
  if (items.length === 0) throw new Error('No pages selected');

  const srcDocs = new Map<number, PdfDocLike>();
  await Promise.all(
    buffers.map(async (b) => {
      srcDocs.set(b.id, await env.loadDocument(b.data));
    }),
  );

  let pw = PAGE_SIZES.a4[0];
  let ph = PAGE_SIZES.a4[1];
  if (layout.pageSize === 'letter') {
    pw = PAGE_SIZES.letter[0];
    ph = PAGE_SIZES.letter[1];
  } else if (layout.pageSize === 'original') {
    const first = items[0];
    const p = await srcDocs.get(first.docId)!.getPage(first.pageNumber);
    const vp = p.getViewport({ scale: 1 });
    pw = vp.width;
    ph = vp.height;
  }
  if (layout.orientation === 'landscape') {
    const t = pw;
    pw = ph;
    ph = t;
  }

  const rows = Math.max(1, layout.rows);
  const cols = Math.max(1, layout.cols);
  const marginX = 18;
  const marginTop = 18;
  const marginBottom = layout.pageNumbers ? 34 : 18;
  const gap = 10;
  const cellW = (pw - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (ph - marginTop - marginBottom - gap * (rows - 1)) / rows;
  const { dpi, jpeg } = QUALITY[layout.quality];

  // spread samples evenly across the selection
  const step = Math.max(1, Math.floor(items.length / Math.min(sampleCount, items.length)));
  const sampled: Array<{ item: ComposeItem; index: number }> = [];
  for (let i = 0; i < items.length && sampled.length < sampleCount; i += step) {
    const item = items[i];
    if (!item.blank) sampled.push({ item, index: i });
  }

  let sizeSum = 0;
  let inkSavedSum = 0;
  let beforeSum = 0;
  let n = 0;

  for (const { item } of sampled) {
    const src = srcDocs.get(item.docId);
    if (!src) continue;
    const pdfPage = await src.getPage(item.pageNumber);
    const base = pdfPage.getViewport({ scale: 1 });
    const rotation = (base.rotation + item.rotation) % 360;
    const targetPxW = (cellW * dpi) / 72;
    const scale = Math.min(4, Math.max(0.3, targetPxW / base.width));
    const viewport = pdfPage.getViewport({ scale, rotation });

    const canvas = env.createCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    );
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyCtx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;

    const before = inkCoverage(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const effMode = resolveColorMode(canvas, filters.colorMode);
    applyFilters(canvas, filters, effMode);
    let finalCanvas: AnyCanvas = canvas;
    if (filters.trimMargins) finalCanvas = trimCanvasMargins(canvas);

    if (before > 0.03) {
      const afterCtx = finalCanvas.getContext('2d', {
        willReadFrequently: true,
      }) as AnyCtx;
      const after = inkCoverage(afterCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height).data);
      inkSavedSum += Math.max(0, (before - after) / before);
      beforeSum += before;
      n++;
    }

    const bytes = await canvasToJpegBytes(finalCanvas, jpeg);
    sizeSum += bytes.length;
    pdfPage.cleanup();
  }

  const sampledCount = sampled.length || 1;
  const avgJpeg = sizeSum / sampledCount;
  const outputPages = estimateOutputPages(items.length, layout);
  const perPageCap = rows * cols;
  // slides count after booklet padding (booklet pads to multiple of 4)
  const slideCount = layout.booklet ? Math.ceil(items.length / 4) * 4 : items.length;
  const estBytes = Math.round(avgJpeg * slideCount + outputPages * 2600 + (layout.pageNumbers || layout.footerLabel ? outputPages * 400 : 0));

  return {
    outputPages,
    estBytes,
    inkSavedPct: n ? Math.min(95, Math.round((inkSavedSum / n) * 100)) : 0,
    beforeInkPct: n ? Math.min(100, Math.round((beforeSum / n) * 100)) : perPageCap > 0 ? 90 : 0,
    sampled: sampled.length,
  };
}
