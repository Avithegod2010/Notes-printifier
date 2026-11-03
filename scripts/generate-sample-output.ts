/**
 * Generate the "after" example PDF (public/sample-printified.pdf) from the
 * bundled sample lecture (public/sample-lecture.pdf) using the SAME pipeline
 * as the browser app, so the before/after example shown in the UI is genuine:
 *   - Invert color mode (dark slides -> white pages)
 *   - Ink Saver 45 (levels: whiteCut 214.5 / blackCut 24.75)
 *   - A4 portrait, 3 rows x 1 col, separators, page numbers, medium quality
 * Mirrors src/lib/pdf/compose.ts + filters.ts (invert branch).
 */
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';

const SRC = '/home/z/my-project/public/sample-lecture.pdf';
const OUT = '/home/z/my-project/public/sample-printified.pdf';

// ---- filter settings (must match compose defaults used for dark decks) -----
const INK_SAVER = 45; // percent
const JPEG_QUALITY = 68; // matches compose.ts "medium" (0.68)

// ---- layout settings (must match defaultLayout in compose.ts) --------------
const A4: [number, number] = [595.28, 841.89];
const ROWS = 3;
const COLS = 1;
const MARGIN_X = 18;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 34; // room for page numbers
const GAP = 10;
const DPI = 150; // compose.ts "medium"

function levels(v: number, blackCut: number, whiteCut: number): number {
  if (v <= blackCut) return 0;
  if (v >= whiteCut) return 255;
  return ((v - blackCut) * 255) / (whiteCut - blackCut);
}

/** Mirror of filters.ts isInvertStainPixel (post-invert stain cleanup). */
function isInvertStainPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  if (diff < 8) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (diff >= 12 && g > r + 12 && b > r + 12 && lum >= 170) return true;
  if (diff <= 75 && lum >= 200) return true;
  return false;
}

function inkCoverage(d: Uint8ClampedArray): number {
  let dark = 0;
  let total = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (y < 205) dark++;
    total++;
  }
  return total === 0 ? 0 : dark / total;
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const c = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas: c, context: c.getContext('2d') as CanvasRenderingContext2D };
  }
  reset(ctx: { canvas: unknown }, width: number, height: number) {
    (ctx.canvas as { width: number; height: number }).width = width;
    (ctx.canvas as { height: number }).height = height;
  }
  destroy(ctx: { canvas: unknown }) {
    (ctx.canvas as { width: number }).width = 0;
    (ctx.canvas as { height: number }).height = 0;
  }
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(await readFile(SRC));
const src = await pdfjs.getDocument({
  data,
  canvasFactory: new NodeCanvasFactory(),
  isEvalSupported: false,
  // The legacy build resolves wasm/fallback modules through node:fs, so this
  // must be a filesystem path (not file:// or http://) for JPX (JPEG2000)
  // images to decode. Without it, some diagrams render faint/blank.
  wasmUrl: '/home/z/my-project/node_modules/pdfjs-dist/wasm/',
}).promise;

console.log('source pages:', src.numPages);

const out = await PDFDocument.create();
const font = await out.embedFont(StandardFonts.Helvetica);

const [pw, ph] = A4;
const perPage = ROWS * COLS;
const cellW = (pw - MARGIN_X * 2 - GAP * (COLS - 1)) / COLS;
const cellH = (ph - MARGIN_TOP - MARGIN_BOTTOM - GAP * (ROWS - 1)) / ROWS;

const lineColor = rgb(0.75, 0.75, 0.75); // neutral — matches compose.ts
const textColor = rgb(0.45, 0.45, 0.45);

const strength = INK_SAVER / 100;
const whiteCut = 255 - strength * 90;
const blackCut = strength * 55;

let inkBeforeSum = 0;
let inkAfterSum = 0;
let inkSamples = 0;

const chunks: number[][] = [];
for (let i = 1; i <= src.numPages; i += perPage) {
  const c: number[] = [];
  for (let p = i; p < i + perPage && p <= src.numPages; p++) c.push(p);
  chunks.push(c);
}
console.log('output pages:', chunks.length);

for (let ci = 0; ci < chunks.length; ci++) {
  const page = out.addPage([pw, ph]);

  for (let local = 0; local < chunks[ci].length; local++) {
    const pageNum = chunks[ci][local];
    const pdfPage = await src.getPage(pageNum);
    const base = pdfPage.getViewport({ scale: 1 });

    const targetPxW = (cellW * DPI) / 72;
    const scale = Math.min(4, Math.max(0.3, targetPxW / base.width));
    const viewport = pdfPage.getViewport({ scale });

    const canvas = createCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    );
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({
      canvasContext: ctx as never,
      viewport,
      canvasFactory: new NodeCanvasFactory(),
    } as never).promise;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;

    if (inkSamples < 6) {
      inkBeforeSum += inkCoverage(d);
    }

    // applyFilters — invert branch WITH stain cleanup (mirrors filters.ts:
    // inverted brown/navy backgrounds and red key fills are killed, then
    // levels pushes the remaining background to pure white).
    for (let i = 0; i < d.length; i += 4) {
      let r = 255 - d[i];
      let g = 255 - d[i + 1];
      let b = 255 - d[i + 2];
      if (isInvertStainPixel(r, g, b)) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        continue;
      }
      r = levels(r, blackCut, whiteCut);
      g = levels(g, blackCut, whiteCut);
      b = levels(b, blackCut, whiteCut);
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
    ctx.putImageData(img, 0, 0);

    if (inkSamples < 6) {
      inkAfterSum += inkCoverage(d);
      inkSamples++;
    }

    const jpg: Buffer = canvas.toBuffer('image/jpeg', JPEG_QUALITY);
    const embedded = await out.embedJpg(jpg);

    const s = Math.min(cellW / embedded.width, cellH / embedded.height);
    const w = embedded.width * s;
    const h = embedded.height * s;
    const col = local % COLS;
    const row = Math.floor(local / COLS);
    const x = MARGIN_X + col * (cellW + GAP) + (cellW - w) / 2;
    const y = ph - MARGIN_TOP - row * (cellH + GAP) - cellH + (cellH - h) / 2;
    page.drawImage(embedded, { x, y, width: w, height: h });

    pdfPage.cleanup();
    if (ci % 4 === 0) console.log(`  processed page ${pageNum}/${src.numPages}`);
  }

  // separators between rows (same geometry as compose.ts finishPage)
  for (let r = 0; r < ROWS - 1; r++) {
    const y = ph - MARGIN_TOP - r * (cellH + GAP) - cellH - GAP / 2;
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: pw - MARGIN_X, y },
      thickness: 0.7,
      color: lineColor,
    });
  }
  const numText = String(ci + 1);
  const tw = font.widthOfTextAtSize(numText, 9);
  page.drawText(numText, {
    x: (pw - tw) / 2,
    y: 12,
    size: 9,
    font,
    color: textColor,
  });
}

const bytes = await out.save();
await writeFile(OUT, bytes);
console.log('written:', OUT, (bytes.length / 1024 / 1024).toFixed(2) + ' MB');
if (inkSamples > 0) {
  const before = (inkBeforeSum / inkSamples) * 100;
  const after = (inkAfterSum / inkSamples) * 100;
  console.log(
    `ink coverage: ${before.toFixed(1)}% -> ${after.toFixed(1)}%  (saved ${(
      ((before - after) / before) *
      100
    ).toFixed(0)}%)`,
  );
}
