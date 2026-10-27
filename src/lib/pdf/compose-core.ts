/**
 * compose-core.ts — the shared PDF composition pipeline.
 *
 * Runs in TWO contexts with the exact same code:
 *  - main thread (env.createCanvas → <canvas>): fallback for old browsers
 *  - inside a Web Worker (env.createCanvas → OffscreenCanvas): keeps the UI
 *    fully responsive during processing
 *
 * The pipeline:
 *   render page → measure (smart invert + ink stats) → deskew (optional) →
 *   filters → trim (optional) → JPEG → place into rows×cols grid →
 *   pdf-lib A4 output
 *
 * It also records every slide's final placement rectangle, which the OCR
 * text-layer pass maps word bounding boxes onto.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import {
  inkCoverage,
  preparePageCanvas,
  resolveColorMode,
  type AnyCanvas,
  type AnyCtx,
  type FilterSettings,
} from './filters';
import { isBlankishRender } from './render-guard';
import { PAGE_SIZES } from './layout-settings';

import {
  composeItemKey,
  estimateOutputPages,
  fixedPageSize,
  resolveQuality,
  sheetMargins,
  type ComposeItem,
  type CoverSheetData,
  type LayoutSettings,
  type Placement,
} from './layout-settings';

/** Pure layout types/defaults/math live in layout-settings.ts (bundle-light);
 *  re-exported here so every legacy import keeps working. */
export * from './layout-settings';

export interface ComposeOptions {
  /** Raw PDF bytes, each tagged with the docId it belongs to. */
  buffers: Array<{ id: number; data: ArrayBuffer }>;
  /** Selected pages, already in the desired order. */
  items: ComposeItem[];
  filters: FilterSettings;
  layout: LayoutSettings;
  /**
   * LABS text-repaint: pre-rendered canvases (OCR text re-typeset as black
   * on white), keyed by composeItemKey(item). When an entry exists for an
   * item, the pdf.js page render is SKIPPED entirely and this canvas flows
   * through the normal preparePageCanvas chain instead — that skip is the
   * perf win. Items without an entry render from the PDF as usual.
   */
  repaintCanvases?: Map<string, AnyCanvas> | null;
  /** Pre-formatted strings + per-document entries for the batch cover page.
   *  Supplied by the store (already translated); core only draws. */
  coverSheetData?: CoverSheetData | null;
  /** Upper bound for JPEG quality when the size target needs recompression.
   *  Never RAISES quality above what the layout preset chose. */
  jpegQualityOverride?: number;
  /**
   * Pre-rendered recipe QR PNG (small, ~1–3 KB) — drawn into the footer band
   * of every output sheet when layout.recipeQr is on. Generated on the MAIN
   * thread with the `qrcode` package (needs a DOM canvas), so the worker
   * only ever embeds ready-made bytes.
   */
  recipeQrPng?: Uint8Array | null;
  onProgress?: (done: number, total: number) => void;
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
  /** How many items used a text-repaint canvas instead of a page render. */
  repainted: number;
  /**
   * Pages whose render came back blank (pdf.js image-decode failure, worker
   * race, OOM canvas) or that are essentially empty. Filters — above all
   * INVERT — were skipped for them so a blank render can never print as a
   * solid-black sheet. 0 in a healthy run.
   */
  blankSkipped: number;
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
interface PdfPageLike {
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

  // Optional document metadata (title / author) — safe for any unicode input
  // (pdf-lib writes metadata strings as PDF hex strings).
  if (o.layout.docTitle && o.layout.docTitle.trim()) {
    out.setTitle(o.layout.docTitle.trim().slice(0, 120));
  }
  if (o.layout.docAuthor && o.layout.docAuthor.trim()) {
    out.setAuthor(o.layout.docAuthor.trim().slice(0, 120));
  }
  out.setCreator('Notes Printifier');
  out.setProducer('Notes Printifier (printifier.app)');

  // ---- output page geometry -------------------------------------------------
  let pw = PAGE_SIZES.a4[0];
  let ph = PAGE_SIZES.a4[1];
  const fixed = fixedPageSize(o.layout);
  if (fixed) {
    pw = fixed[0];
    ph = fixed[1];
  } else {
    // 'original' — first selected page decides
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
  const margins = sheetMargins(o.layout);
  const marginX = margins.x;
  const marginTop = margins.top;
  const marginBottom = margins.bottom;
  const gap = 10;
  const cellW = (pw - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (ph - marginTop - marginBottom - gap * (rows - 1)) / rows;
  // 3-up handout mode: each slide shrinks to the left 62% of its cell and the
  // freed right side carries ruled note lines (classic PowerPoint handout).
  const noteLinesOn = !!o.layout.noteLines && rows === 3 && cols === 1 && !o.layout.booklet;
  const slideBoxW = noteLinesOn ? cellW * 0.62 : cellW;
  const linesX = marginX + slideBoxW + 8;
  const LINES_COUNT = 7;

  const { dpi, jpeg } = resolveQuality(o.layout);
  // Size-target recompression: the store may re-run the compose with a lower
  // quality ceiling — never let it RAISE the preset's choice.
  const jpegEff =
    typeof o.jpegQualityOverride === 'number' && o.jpegQualityOverride > 0
      ? Math.min(jpeg, Math.max(0.28, Math.min(1, o.jpegQualityOverride)))
      : jpeg;

  // Pure neutral grays — a blue-tinted separator (0.72,0.72,0.76) printed as a
  // faint blue line, which users read as a leftover "blue mark".
  const lineColor = rgb(0.75, 0.75, 0.75);
  const textColor = rgb(0.45, 0.45, 0.45);

  // ---- recipe QR (physical handout carries its own recipe) ----------------
  // Embedded once; drawn bottom-left into every sheet's footer band. The
  // footer label text shifts right to make room.
  let qrImage: Awaited<ReturnType<typeof out.embedPng>> | null = null;
  if (o.layout.recipeQr && o.recipeQrPng && o.recipeQrPng.byteLength > 0) {
    try {
      qrImage = await out.embedPng(o.recipeQrPng);
    } catch (err) {
      console.warn('[compose] recipe QR embed failed — printing without it', err);
    }
  }
  const QR_SIZE = 26; // pt — scannable at arm's length, fits the footer band
  const qrLabelOffset = qrImage ? QR_SIZE + 10 : 0;

  // ---- batch cover page ----------------------------------------------------
  // One unnumbered page before the content: app title, date and the list of
  // merged documents. Booklet mode is excluded — a portrait cover page would
  // break the saddle-stitch sheet order.
  const wantCover = !!o.layout.coverSheet && !o.layout.booklet && !!o.coverSheetData;
  if (wantCover) {
    const cover = o.coverSheetData!;
    const boldFont = await out.embedFont(StandardFonts.HelveticaBold);
    const coverPage = out.addPage([pw, ph]);
    const center = (text: string, size: number, y: number, f = font, c = textColor) => {
      coverPage.drawText(text, {
        x: (pw - f.widthOfTextAtSize(text, size)) / 2,
        y,
        size,
        font: f,
        color: c,
      });
    };
    const ink = rgb(0.25, 0.2, 0.35);
    center(cover.title.slice(0, 60), 26, ph - 88, boldFont, ink);
    center(cover.subtitle.slice(0, 80), 11, ph - 108);
    coverPage.drawLine({
      start: { x: marginX + 40, y: ph - 122 },
      end: { x: pw - marginX - 40, y: ph - 122 },
      thickness: 0.8,
      color: lineColor,
    });
    coverPage.drawText(cover.contentsHeading.slice(0, 40), {
      x: marginX + 14,
      y: ph - 152,
      size: 12,
      font: boldFont,
      color: ink,
    });
    const rowBottom = 64;
    let y = ph - 186;
    let shown = 0;
    for (const entry of cover.entries) {
      if (y < rowBottom + 14) break;
      const name = entry.name.length > 52 ? entry.name.slice(0, 49) + '…' : entry.name;
      coverPage.drawText(name, { x: marginX + 14, y, size: 10.5, font, color: ink });
      const label = entry.label.slice(0, 24);
      coverPage.drawText(label, {
        x: pw - marginX - 14 - font.widthOfTextAtSize(label, 9),
        y,
        size: 9,
        font,
        color: textColor,
      });
      y -= 20;
      shown++;
    }
    if (shown < cover.entries.length) {
      const more = `+ ${cover.entries.length - shown}`;
      coverPage.drawText(more, { x: marginX + 14, y, size: 10.5, font, color: textColor });
    }
    center(cover.footnote.slice(0, 90), 8.5, 30);
  }
  const pageOffset = wantCover ? 1 : 0;

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
    if (qrImage) {
      page.drawImage(qrImage, {
        x: marginX,
        y: 8,
        width: QR_SIZE,
        height: QR_SIZE,
      });
    }
    if (o.layout.footerLabel && o.layout.footerLabel.trim()) {
      const label = o.layout.footerLabel.trim().slice(0, 60);
      page.drawText(label, {
        x: marginX + qrLabelOffset,
        y: 12,
        size: 8,
        font,
        color: textColor,
      });
    }
    if (o.layout.nameStamp && o.layout.nameStamp.trim()) {
      const stamp = o.layout.nameStamp.trim().slice(0, 40);
      const size = 8.5;
      const tw = font.widthOfTextAtSize(stamp, size);
      page.drawText(stamp, {
        x: pw - marginX - tw,
        y: 12,
        size,
        font,
        color: textColor,
        opacity: 0.85,
      });
    }
  };

  // ---- main pass ------------------------------------------------------------
  let inkSavedSum = 0;
  let inkSamples = 0;
  let inkBeforeSum = 0;
  let autoInverted = 0;
  let repainted = 0;
  let blankSkipped = 0;
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

      // LABS text-repaint: when a repaint canvas exists for this item, use it
      // INSTEAD of rendering the pdf page (skipping the render entirely is the
      // perf win). The canvas still goes through the normal chain below.
      const repaintCanvas = o.repaintCanvases?.get(composeItemKey(item)) ?? null;

      let canvas: AnyCanvas;
      let ctx: AnyCtx;
      let pdfPage: PdfPageLike | null = null;
      /** Set when the render came back blank — filters must be skipped. */
      let blankRender = false;
      if (repaintCanvas) {
        canvas = repaintCanvas;
        repainted++;
        const repaintCtx = canvas.getContext('2d', {
          willReadFrequently: true,
        }) as AnyCtx | null;
        if (!repaintCtx) throw new Error('Canvas 2D context unavailable');
        ctx = repaintCtx;
      } else {
        const src = srcDocs.get(item.docId);
        if (!src) {
          throw new Error(
            'Source file is no longer available — please go back and re-upload it.',
          );
        }
        pdfPage = await src.getPage(item.pageNumber);
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

        const renderOnce = async (): Promise<{ canvas: AnyCanvas; ctx: AnyCtx }> => {
          const c = env.createCanvas(
            Math.max(1, Math.floor(viewport.width)),
            Math.max(1, Math.floor(viewport.height)),
          );
          const cctx = c.getContext('2d', {
            willReadFrequently: true,
          }) as AnyCtx | null;
          if (!cctx) throw new Error('Canvas 2D context unavailable');
          cctx.fillStyle = '#ffffff';
          cctx.fillRect(0, 0, c.width, c.height);
          await pdfPage!.render({ canvasContext: cctx, viewport }).promise;
          return { canvas: c, ctx: cctx };
        };
        ({ canvas, ctx } = await renderOnce());

        // Blank-render guard (the "full black page" bug): pdf.js resolves
        // the render promise even when a JPX/JBIG2 image failed to decode
        // and NOTHING was drawn. The canvas is pure white here — passing it
        // through invert would output a solid-black ink bomb. Retry once
        // (transient worker/wasm races usually clear), then, if the page is
        // still blank, keep it un-inverted and count it for the UI warning.
        if (isBlankishRender(canvas)) {
          ({ canvas, ctx } = await renderOnce());
          if (isBlankishRender(canvas)) {
            blankRender = true;
            blankSkipped++;
            console.warn(
              `[compose] p.${item.pageNumber} of doc ${item.docId} rendered blank — filters skipped so it cannot print black`,
            );
          }
        }
      }

      // smart per-page invert decision (before any filtering)
      // Per-page override (F: "keep slide 3 colorful") — merged over the
      // global filters for THIS item only.
      const effFilters = item.override
        ? { ...o.filters, ...item.override }
        : o.filters;
      // A blank render must never be inverted — a white canvas + invert is
      // exactly how whole pages printed solid black.
      const effMode = resolveColorMode(
        canvas,
        blankRender ? 'original' : effFilters.colorMode,
      );
      if (effFilters.colorMode === 'auto' && effMode === 'invert') autoInverted++;

      // ink estimate on the first few pages only (cheap)
      let before = 0;
      if (inkSamples < 6) {
        before = inkCoverage(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      }

      // deskew (optional) → filters → trim — the exact per-page chain,
      // worker-safe, in one call
      const finalCanvas = preparePageCanvas(canvas, effFilters, effMode);

      if (inkSamples < 6 && before > 0.03) {
        const afterCtx = finalCanvas.getContext('2d', {
          willReadFrequently: true,
        }) as AnyCtx;
        const after = inkCoverage(afterCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height).data);
        inkBeforeSum += before;
        inkSavedSum += Math.max(0, (before - after) / before);
        inkSamples++;
      }

      const bytes = await canvasToJpegBytes(finalCanvas, jpegEff);
      const img = await out.embedJpg(bytes);

      const s = Math.min(slideBoxW / img.width, cellH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      const col = local % cols;
      const row = Math.floor(local / cols);
      const x = marginX + col * (cellW + gap) + (slideBoxW - w) / 2;
      const y =
        ph - marginTop - row * (cellH + gap) - cellH + (cellH - h) / 2;
      page.drawImage(img, { x, y, width: w, height: h });
      // outPage is the PHYSICAL output page (cover shifts everything by 1) —
      // the OCR text-layer pass indexes pages with it.
      placements.push({ itemIndex, outPage: ci + 1 + pageOffset, x, y, w, h });

      // 3-up note lines — ruled guides in the space right of the slide
      if (noteLinesOn) {
        const lineTop = y + h - 2;
        const lineBot = y + 2;
        for (let li = 0; li < LINES_COUNT; li++) {
          const ly = lineTop - ((lineTop - lineBot) * li) / (LINES_COUNT - 1);
          page.drawLine({
            start: { x: linesX, y: ly },
            end: { x: pw - marginX, y: ly },
            thickness: 0.5,
            color: lineColor,
          });
        }
      }

      // source page number stamped on the slide (bottom-right, small)
      if (o.layout.slideNumbers) {
        const label = `p.${item.pageNumber}`;
        page.drawText(label, {
          x: x + w - font.widthOfTextAtSize(label, 7) - 3,
          y: y + 2,
          size: 7,
          font,
          color: textColor,
        });
      }

      pdfPage?.cleanup();

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

  return {
    pdfBytes,
    outputPages: chunks.length + pageOffset,
    inkSavedPct,
    beforeInkPct,
    placements,
    autoInverted,
    repainted,
    blankSkipped,
  };
}

/**
 * Encode a canvas as JPEG bytes. OffscreenCanvas uses convertToBlob,
 * HTMLCanvasElement uses toBlob.
 */
async function canvasToJpegBytes(
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
function makeWhiteCanvas(env: ComposeEnv, w: number, h: number): { canvas: AnyCanvas; ctx: AnyCtx } {
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
  const fixed = fixedPageSize(layout);
  if (fixed) {
    pw = fixed[0];
    ph = fixed[1];
  } else {
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
  const margins = sheetMargins(layout);
  const marginX = margins.x;
  const marginTop = margins.top;
  const marginBottom = margins.bottom;
  const gap = 10;
  const cellW = (pw - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (ph - marginTop - marginBottom - gap * (rows - 1)) / rows;
  const { dpi, jpeg } = resolveQuality(layout);

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
    const effFilters = item.override ? { ...filters, ...item.override } : filters;
    // Same blank guard as the composer — a failed sample render must not
    // skew the estimate through a fake inversion.
    const effMode = resolveColorMode(
      canvas,
      isBlankishRender(canvas) ? 'original' : effFilters.colorMode,
    );
    const finalCanvas = preparePageCanvas(canvas, effFilters, effMode);

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
  const estBytes = Math.round(
    avgJpeg * slideCount +
      outputPages * 2600 +
      (layout.pageNumbers || layout.footerLabel ? outputPages * 400 : 0) +
      (layout.coverSheet && !layout.booklet ? 4000 : 0),
  );

  return {
    outputPages,
    estBytes,
    inkSavedPct: n ? Math.min(95, Math.round((inkSavedSum / n) * 100)) : 0,
    beforeInkPct: n ? Math.min(100, Math.round((beforeSum / n) * 100)) : perPageCap > 0 ? 90 : 0,
    sampled: sampled.length,
  };
}
