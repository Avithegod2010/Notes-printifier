/**
 * ocr-bench.ts — head-to-head OCR benchmark: the SAME page recognized twice,
 * once with PSM 3 (fully automatic page segmentation) and once with PSM 6
 * (assume one uniform text block). Surfaced in the Doctor card so users SEE
 * why the "Recognition mode" switch exists instead of trusting a hunch.
 *
 * Costs one Tesseract worker (terminated afterwards) and two recognitions —
 * user-triggered only, never automatic.
 */

export interface PsmBenchRow {
  psm: '3' | '6';
  /** Tesseract's mean word confidence for the page (0–100). */
  confidence: number;
  /** Words kept at a sane confidence floor. */
  words: number;
  /** Wall-clock time of the recognition pass (ms). */
  ms: number;
}

const RENDER_WIDTH = 1400;
const MIN_WORD_CONFIDENCE = 40;

export async function benchPsmModes(
  buffer: ArrayBuffer,
  pageNumber: number,
  langs: string[],
): Promise<PsmBenchRow[]> {
  const [{ createWorker, OEM, PSM }, { loadPdfDocument }] = await Promise.all([
    import('tesseract.js'),
    import('./pdfjs'),
  ]);
  const doc = await loadPdfDocument(buffer);
  const page = await doc.getPage(Math.max(1, pageNumber));
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, RENDER_WIDTH / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable for OCR bench');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();

  // GitHub Pages hosts the site under /<repo>/ — prefix self-hosted assets.
  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const cleanLangs = langs.filter((l) => /^[a-z]{3}$/.test(l));
  const worker = await createWorker(cleanLangs.length > 0 ? cleanLangs : ['eng'], OEM.LSTM_ONLY, {
    workerPath: `${BASE}/tesseract/worker.min.js`,
    corePath: `${BASE}/tesseract`,
    langPath: `${BASE}/tesseract`,
    gzip: true,
    errorHandler: (e) => console.warn('[ocr-bench]', e),
  });

  try {
    const rows: PsmBenchRow[] = [];
    for (const psm of ['3', '6'] as const) {
      await worker.setParameters({
        tessedit_pageseg_mode: psm === '6' ? PSM.SINGLE_BLOCK : PSM.AUTO,
      });
      const t0 = performance.now();
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const ms = Math.round(performance.now() - t0);
      let confSum = 0;
      let words = 0;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const w of line.words ?? []) {
              if (w.confidence < MIN_WORD_CONFIDENCE) continue;
              if (!(w.text ?? '').trim()) continue;
              confSum += w.confidence;
              words += 1;
            }
          }
        }
      }
      rows.push({
        psm,
        confidence: words > 0 ? Math.round(confSum / words) : 0,
        words,
        ms,
      });
    }
    return rows;
  } finally {
    void worker.terminate();
  }
}
