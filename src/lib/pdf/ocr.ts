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

import { loadPdfDocument } from './pdfjs';
import { composeItemKey, type ComposeItem, type Placement } from './layout-settings';
import type { AnyCanvas, AnyCtx } from './filters';

export interface OcrWord {
  text: string;
  /** bounding box as fractions of the slide width/height (origin: top-left) */
  fx0: number;
  fy0: number;
  fx1: number;
  fy1: number;
  /** Tesseract confidence 0..100 (already ≥ MIN_WORD_CONFIDENCE). */
  confidence: number;
}

interface OcrKey {
  docId: number;
  pageNumber: number;
  rotation: number;
}

const OCR_RENDER_WIDTH = 1100; // px — good accuracy/speed trade-off for OCR
const MIN_WORD_CONFIDENCE = 35;
const MAX_OCR_SLIDES = 120; // hard cap — beyond this the wait isn't worth it

/**
 * Language codes accepted by Tesseract (ISO 639-2). The UI passes user-facing
 * combos (e.g. ['eng','hin']) straight through; the matching .traineddata.gz
 * files ship self-hosted in /public/tesseract so OCR stays fully offline.
 */
export type OcrLang = 'eng' | 'hin' | 'tam' | 'guj' | 'pan';

/**
 * Per-slide OCR quality report — feeds the result-page confidence card
 * ("page 7 looked like a handwriting scan, 61% confidence").
 */
export interface OcrPageReport {
  docId: number;
  pageNumber: number;
  rotation: number;
  /** Page-level Tesseract confidence 0..100 (whole-slide average). */
  confidence: number;
  /** Words that survived the per-word confidence gate. */
  words: number;
}

/** Strip control characters only — Devanagari/Tamil/etc. text is KEPT. */
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Unicode text layer — script-aware invisible fonts.
//
// The old layer drew every word with Helvetica, which is WinAnsi-only, so any
// Indic word had to be dropped (invisible, but also unsearchable).
// Now: Latin words still use Helvetica, while Indic words (Devanagari, Tamil,
// Gujarati, Gurmukhi) draw with self-hosted Noto Sans fonts (registered via
// @pdf-lib/fontkit). The invisible layer stores real Unicode code points, so
// Ctrl+F finds Hindi, Tamil, Gujarati and Punjabi text even though not a
// single visible pixel changes.
// ---------------------------------------------------------------------------

/** Script detection — first match wins; unknown scripts fall back to Helvetica. */
function isDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}
function isTamil(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text);
}
function isGujarati(text: string): boolean {
  return /[\u0A80-\u0AFF]/.test(text);
}
function isGurmukhi(text: string): boolean {
  return /[\u0A00-\u0A7F]/.test(text);
}

const FONT_PATHS = {
  deva: '/fonts/NotoSansDevanagari-Regular.ttf',
  tamil: '/fonts/NotoSansTamil-Regular.ttf',
  gujr: '/fonts/NotoSansGujarati-Regular.ttf',
  guru: '/fonts/NotoSansGurmukhi-Regular.ttf',
} as const;

const fontBytesCache = new Map<string, ArrayBuffer>();

/** Fetch (and cache) a self-hosted Noto font. GitHub Pages subpath aware. */
async function getFontBytes(kind: keyof typeof FONT_PATHS): Promise<ArrayBuffer> {
  const cached = fontBytesCache.get(kind);
  if (cached) return cached;
  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const res = await fetch(`${BASE}${FONT_PATHS[kind]}`);
  if (!res.ok) throw new Error(`Font ${kind} unavailable (${res.status})`);
  const buf = await res.arrayBuffer();
  fontBytesCache.set(kind, buf);
  return buf;
}

/** Does ANY word anywhere need the Devanagari (or Tamil) font? */
function needsScriptFont(wordsByKey: Map<string, OcrWord[]>, test: (s: string) => boolean): boolean {
  for (const words of wordsByKey.values()) {
    for (const w of words) {
      if (test(w.text)) return true;
    }
  }
  return false;
}

function ocrKeyString(k: OcrKey): string {
  // delegate to the shared helper so OCR keys can never drift from the
  // compose-side lookup keys (same docId:page:rotation format)
  return composeItemKey(k);
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
 * `langs` — Tesseract language codes (default ['eng']); combos like
 * ['eng','hin'] recognize mixed-script decks.
 * `psm` — Tesseract page-segmentation mode: '3' = auto (default),
 * '6' = single uniform text block (often better for handwritten notes).
 * `onPageReport` — optional per-slide quality callback (confidence card).
 */
export async function ocrComposeItems(
  buffers: Array<{ id: number; data: ArrayBuffer }>,
  items: ComposeItem[],
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
  langs: string[] = ['eng'],
  psm: string = '3',
  onPageReport?: (r: OcrPageReport) => void,
): Promise<Map<string, OcrWord[]>> {
  const unique = new Map<string, OcrKey>();
  for (const item of items) {
    if (item.blank) continue;
    const key = composeItemKey(item);
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

  const { createWorker, OEM, PSM } = await import('tesseract.js');
  // GitHub Pages hosts the site under /<repo>/ — prefix self-hosted assets.
  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const cleanLangs = langs.filter((l) => /^[a-z]{3}$/.test(l));
  const worker = await createWorker(
    cleanLangs.length > 0 ? cleanLangs : ['eng'],
    OEM.LSTM_ONLY,
    {
      workerPath: `${BASE}/tesseract/worker.min.js`,
      corePath: `${BASE}/tesseract`,
      langPath: `${BASE}/tesseract`,
      gzip: true,
      errorHandler: (e) => console.warn('[ocr]', e),
    },
  );

  try {
    // OCR quality preset — expose tessedit_pageseg_mode. PSM 3 (auto) is
    // right for slides / multi-column layouts; PSM 6 treats the page as ONE
    // uniform text block, which frequently rescues handwriting + single
    // column scans that auto mode fragments.
    await worker.setParameters({
      tessedit_pageseg_mode: psm === '6' ? PSM.SINGLE_BLOCK : PSM.AUTO,
    });

    const docs = new Map<number, Awaited<ReturnType<typeof loadPdfDocument>>>();
    const buffersById = new Map(buffers.map((b) => [b.id, b.data]));

    let done = 0;
    for (const [key, k] of unique) {
      // `isCancelled` follows the store's isActive convention: TRUE = the job
      // is still running, FALSE = the user cancelled. (This check used to be
      // inverted, so every searchable job bailed out on its first slide.)
      if (isCancelled && !isCancelled()) throw new Error('OCR cancelled');
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
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
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
              words.push({ text, fx0, fy0, fx1, fy1, confidence: w.confidence });
            }
          }
        }
      }
      results.set(key, words);

      onPageReport?.({
        docId: k.docId,
        pageNumber: k.pageNumber,
        rotation: k.rotation,
        // page-level confidence (whole-slide average over everything
        // Tesseract saw, kept or not) — the honest quality signal
        confidence: Math.round(data.confidence ?? 0),
        words: words.length,
      });

      done++;
      onProgress?.(done, total);
    }
  } finally {
    await worker.terminate();
  }

  return results;
}

/**
 * Group OCR word boxes into text lines by clustering vertical centers
 * (tolerance ≈ 0.6 × median word height). Words inside a line are sorted
 * left-to-right so the repaint pass draws them in reading order.
 */
function groupOcrWordsIntoLines(words: OcrWord[]): OcrWord[][] {
  if (words.length === 0) return [];
  const heights = words.map((w) => w.fy1 - w.fy0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)];
  const tol = 0.6 * medianH;
  const sorted = [...words].sort(
    (a, b) => (a.fy0 + a.fy1) / 2 - (b.fy0 + b.fy1) / 2,
  );
  const lines: OcrWord[][] = [];
  let current: OcrWord[] = [];
  let center = 0;
  for (const w of sorted) {
    const c = (w.fy0 + w.fy1) / 2;
    if (current.length === 0 || Math.abs(c - center) <= tol) {
      if (current.length === 0) {
        center = c;
      } else {
        // running mean keeps the cluster anchored as it grows
        center = (center * current.length + c) / (current.length + 1);
      }
      current.push(w);
    } else {
      lines.push(current);
      current = [w];
      center = c;
    }
  }
  if (current.length) lines.push(current);
  for (const line of lines) line.sort((a, b) => a.fx0 - b.fx0);
  return lines;
}

/** Repaint quality gates: fewer words / lower confidence → keep the scan. */
const REPAINT_MIN_WORDS = 8;
const REPAINT_MIN_AVG_CONFIDENCE = 55;

/** OffscreenCanvas when available, else a document canvas (worker-safe). */
function makeRepaintCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c;
}

/**
 * LABS "text repaint": build one crisp black-on-white canvas per unique
 * slide, re-typesetting the OCR word boxes (per word — spacing is preserved,
 * words are NOT joined into strings). Keys are composeItemKey format, the
 * exact keys composePdfCore looks up. Slides that fail the quality gates
 * (< 8 words, avg confidence < 55) get NO entry → compose falls back to the
 * original scan for them.
 *
 * Consumes the output of the SAME OCR pass that feeds the searchable layer,
 * so enabling repaint never runs Tesseract twice. MAX_OCR_SLIDES is already
 * enforced inside ocrComposeItems — repaint can never exceed it (it only
 * consumes keys that pass produced).
 */
export async function buildRepaintCanvases(
  buffers: Array<{ id: number; data: ArrayBuffer }>,
  items: ComposeItem[],
  wordsByKey: Map<string, OcrWord[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, AnyCanvas>> {
  const out = new Map<string, AnyCanvas>();
  const unique = new Map<string, OcrKey>();
  for (const item of items) {
    if (item.blank) continue;
    const key = composeItemKey(item);
    if (!unique.has(key) && wordsByKey.has(key)) {
      unique.set(key, { docId: item.docId, pageNumber: item.pageNumber, rotation: item.rotation });
    }
  }
  const total = unique.size;
  if (total === 0) return out;

  const docs = new Map<number, Awaited<ReturnType<typeof loadPdfDocument>>>();
  const buffersById = new Map(buffers.map((b) => [b.id, b.data]));

  let done = 0;
  for (const [key, k] of unique) {
    const words = wordsByKey.get(key) ?? [];
    const avgConfidence = words.length
      ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
      : 0;
    if (words.length < REPAINT_MIN_WORDS || avgConfidence < REPAINT_MIN_AVG_CONFIDENCE) {
      done++;
      onProgress?.(done, total);
      continue;
    }
    try {
      // Only the page DIMENSIONS are needed — the repaint canvas is white
      // paper + re-typeset text, no scan content is drawn.
      let doc = docs.get(k.docId);
      if (!doc) {
        const buf = buffersById.get(k.docId);
        if (!buf) throw new Error('Source file is no longer available for repaint');
        doc = await loadPdfDocument(buf);
        docs.set(k.docId, doc);
      }
      const page = await doc.getPage(k.pageNumber);
      const base = page.getViewport({ scale: 1 });
      // Same dimensions logic as the OCR render in ocrComposeItems — word
      // boxes are fractions of this viewport, so any consistent aspect works.
      const scale = Math.min(3, OCR_RENDER_WIDTH / base.width);
      const rotation = (base.rotation + k.rotation) % 360;
      const viewport = page.getViewport({ scale, rotation });
      const w = Math.max(1, Math.floor(viewport.width));
      const h = Math.max(1, Math.floor(viewport.height));
      page.cleanup();

      const canvas = makeRepaintCanvas(w, h);
      const ctx = canvas.getContext('2d') as AnyCtx | null;
      if (!ctx) throw new Error('Canvas unavailable for repaint');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'alphabetic';
      for (const line of groupOcrWordsIntoLines(words)) {
        for (const wd of line) {
          // box height fraction × canvas height, clamped so noise / giant
          // boxes can't produce absurd font sizes
          const wordHeightPx = (wd.fy1 - wd.fy0) * h;
          const px = Math.min(90, Math.max(9, Math.round(wordHeightPx)));
          ctx.font = `${px}px sans-serif`;
          // baseline sits slightly above the box bottom (descender margin)
          ctx.fillText(wd.text, wd.fx0 * w, wd.fy1 * h - 0.15 * wordHeightPx);
        }
      }
      out.set(key, canvas);
    } catch (err) {
      // one broken slide must not kill the pass — it just keeps its scan
      console.warn('[ocr] repaint build failed, keeping original scan:', key, err);
    }
    done++;
    onProgress?.(done, total);
  }

  return out;
}

/**
 * Draw the invisible text layer onto the composed PDF bytes.
 * Maps OCR word fractions through each slide's final placement rect.
 *
 * Script-aware: Latin words draw with Helvetica (built into every PDF
 * viewer); Indic words (Devanagari, Tamil, Gujarati, Gurmukhi) draw with
 * self-hosted Noto fonts embedded
 * via fontkit so the Unicode text survives into the PDF (searchable/copyable)
 * even though it renders at opacity 0. Font files are fetched lazily — a
 * pure-English job never downloads a byte of them.
 */
export async function addOcrTextLayer(
  pdfBytes: Uint8Array,
  items: ComposeItem[],
  placements: Placement[],
  wordsByKey: Map<string, OcrWord[]>,
): Promise<Uint8Array> {
  // pdf-lib loads on demand — keeps it out of the initial JS bundle.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const transparent = rgb(0, 0, 0);

  // Unicode fonts, embedded only when the OCR words actually need them.
  // Each Indic script maps to its self-hosted Noto face; fontkit is
  // registered once and every wanted font embeds independently — one
  // unavailable face must not sink the others.
  type ScriptFontKind = keyof typeof FONT_PATHS;
  const SCRIPT_FONTS: ReadonlyArray<{
    kind: ScriptFontKind;
    test: (s: string) => boolean;
  }> = [
    { kind: 'deva', test: isDevanagari },
    { kind: 'tamil', test: isTamil },
    { kind: 'gujr', test: isGujarati },
    { kind: 'guru', test: isGurmukhi },
  ];
  const embedded = new Map<ScriptFontKind, Awaited<ReturnType<typeof doc.embedFont>>>();
  const wanted = SCRIPT_FONTS.filter((s) => needsScriptFont(wordsByKey, s.test));
  if (wanted.length > 0) {
    try {
      const fontkit = (await import('@pdf-lib/fontkit')).default;
      doc.registerFontkit(fontkit);
    } catch (err) {
      console.warn('[ocr] fontkit unavailable:', err);
    }
    for (const s of wanted) {
      try {
        const bytes = await getFontBytes(s.kind);
        try {
          embedded.set(s.kind, await doc.embedFont(bytes, { subset: true }));
        } catch {
          embedded.set(s.kind, await doc.embedFont(bytes)); // unsubset fallback
        }
      } catch (err) {
        // best-effort: that script's words fall back to Helvetica (and are
        // skipped per-word) — Latin and the other scripts still land.
        console.warn('[ocr] Unicode font unavailable:', s.kind, err);
      }
    }
  }

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
      let scriptKind: ScriptFontKind | null = null;
      for (const s of SCRIPT_FONTS) {
        if (s.test(text)) {
          scriptKind = s.kind;
          break;
        }
      }
      const wordFont = scriptKind ? embedded.get(scriptKind) ?? null : font;
      if (!wordFont) continue; // script needs a font we couldn't embed
      try {
        page.drawText(text, {
          x,
          y,
          size: Math.min(fontSize, 42),
          font: wordFont,
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
