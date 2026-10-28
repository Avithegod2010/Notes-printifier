import { create } from 'zustand';
import { loadPdfDocument, type PdfDocument } from './pdf/pdfjs';
import { renderPageToCanvas, canvasToDataUrl, getPageDimensions } from './pdf/render';
import {
  defaultFilters,
  type AnyCanvas,
  type FilterSettings,
} from './pdf/filters';
import {
  buildBookletItems,
  defaultLayout,
  estimateOutputPages,
  resolveQuality,
  type ComposeItem,
  type CoverSheetData,
  type LayoutSettings,
} from './pdf/layout-settings';
import {
  addOcrTextLayer,
  buildRepaintCanvases,
  countOcrSlides,
  ocrComposeItems,
  type OcrPageReport,
  type OcrWord,
} from './pdf/ocr';
import { saveRecentJob, saveRecentSource, type RecentSourceFile } from './recent-jobs';
import { recordJob } from './ink-stats';
import { isImageFile, imagesToPdfBytes } from './pdf/images-to-pdf';
import {
  allPresets,
  loadPresets,
  savePresetsToDisk,
  makePresetId,
  MAX_PRESETS,
  type Preset,
} from './presets';
import {
  loadRememberFlag,
  loadSavedPrefs,
  loadTextRepaintFlag,
  savePrefs,
  saveRememberFlag,
  saveTextRepaintFlag,
} from './labs';
import { translateStatic, useLangStore, type Lang } from './i18n';
import { HAS_SERVER_API } from './server-api';

/**
 * v1.9 settings migration — the factory default colorMode used to be
 * 'invert', which silently turned every light page of a default-settings
 * job into a solid black print (the "pages came out all black" report).
 * Devices that saved prefs under the old default carry 'invert' without
 * ever having chosen it; remap those to 'auto' (smart per-page invert) so
 * a restored session can never regress to black pages. Deliberate choices
 * of the other modes pass through untouched.
 */
function migrateFilters(f: FilterSettings): FilterSettings {
  if (f.colorMode === 'invert') return { ...f, colorMode: 'auto' };
  return f;
}

interface DocInfo {
  id: number;
  name: string;
  size: number;
  pageCount: number;
}

interface PageItem {
  id: string;
  docId: number;
  pageNumber: number;
  rotation: number;
  selected: boolean;
  /** JPEG data URL — null until lazy rasterization fills it (see ensureThumbs). */
  thumb: string | null;
  widthPt: number;
  heightPt: number;
  /** Detected as (near-)blank — shown as a badge, skipped by "Skip blank". */
  blank?: boolean;
}

interface ProcessResult {
  url: string;
  outputBytes: number;
  outputPages: number;
  inputPages: number;
  inputBytes: number;
  inkSavedPct: number;
  beforeInkPct: number;
  /** Pages the smart (auto) mode inverted on their own. */
  autoInverted: number;
  /** True when the searchable OCR text layer was added successfully. */
  searchable: boolean;
  /** LABS text repaint: how many pages were re-typeset as crisp text (0 = off / all fell back). */
  repainted: number;
  /** Pages that rendered blank and were left un-filtered so they cannot print black. */
  blankSkipped: number;
  /** Set when OCR was requested but failed (PDF itself is still fine). */
  ocrWarning: string | null;
  /** Soft file-size cap the user asked for (MB), null = no cap. */
  sizeTargetMB: number | null;
  /** How many extra recompress passes were needed to (try to) fit the cap. */
  sizeAttempts: number;
  /** OCR quality report — per-slide confidence + the PSM mode used. */
  ocrReport: { pages: OcrPageReport[]; psm: string } | null;
}

/** Raw PDF bytes — kept outside zustand (not serializable, potentially large). */
const docBuffers = new Map<number, ArrayBuffer>();
let nextDocId = 1;

/**
 * Parsed pdf.js documents, one promise per doc — shared by the lazy
 * thumbnail renderer so scrolling the arrange grid never re-parses.
 * (loadPdfDocument slices the buffer, so sharing is safe.)
 */
const pdfDocs = new Map<number, Promise<PdfDocument>>();
/** Page ids currently being rasterized — dedupes IntersectionObserver bursts. */
const thumbJobs = new Set<string>();

/**
 * Thumbnail render semaphore — caps CONCURRENT pdf.js rasterizations across
 * ALL ensureThumbs calls (each IntersectionObserver batch spawns its own
 * call). On a 500-page deck, a fast scroll used to fire dozens of parallel
 * renders on the main thread and the grid stuttered; now at most
 * THUMB_CONCURRENCY render at once, the rest queue FIFO (scroll order =
 * arrival order, so what's on screen fills first). Rasterization runs on
 * the pdf.js worker, but the canvas blit + JPEG encode are main-thread —
 * that's the part the cap protects.
 */
const THUMB_CONCURRENCY = 3;
let thumbActive = 0;
const thumbWaiters: Array<() => void> = [];

/** Acquire a render slot. Resolves with the release function. */
async function acquireThumbSlot(): Promise<() => void> {
  if (thumbActive < THUMB_CONCURRENCY) {
    thumbActive++;
    return releaseThumbSlot;
  }
  await new Promise<void>((resolve) => thumbWaiters.push(resolve));
  thumbActive++;
  return releaseThumbSlot;
}

function releaseThumbSlot(): void {
  thumbActive--;
  thumbWaiters.shift()?.();
}

function getPdfDoc(docId: number): Promise<PdfDocument> | null {
  const buf = docBuffers.get(docId);
  if (!buf) return null;
  let p = pdfDocs.get(docId);
  if (!p) {
    p = loadPdfDocument(buf);
    pdfDocs.set(docId, p);
  }
  return p;
}

/**
 * Mean luminance of a (thumb) canvas — used to guess whether the document is
 * a dark slide deck (→ invert) or a light/white-background document
 * (→ original mode + stain cleanup, since inverting white pages would
 * produce ink-heavy dark prints).
 */
function meanLuminance(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 255;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 13) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  return n === 0 ? 255 : sum / n;
}

/** Access a stored source buffer (used by the live enhance preview). */
export function getDocBuffer(docId: number): ArrayBuffer | undefined {
  return docBuffers.get(docId);
}

/**
 * Fraction of "inked" pixels (luminance < 205) in a canvas — used to detect
 * (near-)blank pages. Rendered text/sketches land well above 1.5%; scanner
 * noise and JPEG artifacts stay below ~1%.
 */
function canvasDarkFraction(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 1;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (y < 205) dark++;
    total++;
  }
  return total === 0 ? 1 : dark / total;
}

async function thumbInkFraction(thumb: string): Promise<number> {
  const img = new Image();
  img.src = thumb;
  await img.decode();
  const w = 64;
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 1;
  ctx.drawImage(img, 0, 0, w, h);
  return canvasDarkFraction(canvas);
}

/**
 * True when every sampled pixel is (nearly) identical — pdf.js occasionally
 * finishes a page render before a dependent (JPX) image is decoded, leaving
 * only the blank background. A second render pass recovers it.
 */
function canvasLooksLikeFailedRender(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4 * 61) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v < min) min = v;
    if (v > max) max = v;
    if (max - min > 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Compose pipeline core — shared by the single-run wizard AND the batch
// queue (F3). Runs the exact same steps: booklet order → optional LABS
// repaint OCR → cover sheet → compose (worker) → size-target recompress →
// optional searchable OCR layer.
// ---------------------------------------------------------------------------

/**
 * Render the recipe QR as PNG bytes on the MAIN thread (the `qrcode`
 * package needs a DOM canvas; the compose worker only embeds ready-made
 * bytes). Returns null when off / the code would be too long / any failure.
 */
async function buildRecipeQrPng(
  filters: FilterSettings,
  layout: LayoutSettings,
): Promise<Uint8Array | null> {
  if (!layout.recipeQr) return null;
  try {
    const { encodeRecipe, recipeUrl } = await import('./recipe-link');
    const code = encodeRecipe(filters, layout);
    if (!code) return null;
    const QR = await import('qrcode');
    const dataUrl = await QR.toDataURL(recipeUrl(code), {
      margin: 1,
      width: 128,
      errorCorrectionLevel: 'M',
    });
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch (err) {
    console.warn('Recipe QR generation failed — printing without it:', err);
    return null;
  }
}

/** Thrown when the job was cancelled (user reset / batch stop). */
export class JobCancelled extends Error {
  constructor() {
    super('Job cancelled');
  }
}

interface JobProgress {
  done: number;
  total: number;
  ocr?: boolean;
}

interface ComposeJobInput {
  docs: DocInfo[];
  /** Page pool for this job — only the selected ones are composed. */
  pages: PageItem[];
  /** Per-page filter overrides keyed by PageItem.id ("keep slide 3 colorful"). */
  overrides?: Record<string, Partial<FilterSettings>>;
  filters: FilterSettings;
  layout: LayoutSettings;
  /** LABS text-repaint flag. */
  repaint: boolean;
  lang: Lang;
  onProgress: (p: JobProgress) => void;
  /** Return false to abort (user cancel / batch stop). */
  isActive: () => boolean;
}

export interface ComposeJobOutput {
  blob: Blob;
  /** Everything except `url` — the caller owns the object-URL lifecycle. */
  result: Omit<ProcessResult, 'url'>;
  fileName: string;
  selectedCount: number;
}

export async function runComposeJob(o: ComposeJobInput): Promise<ComposeJobOutput> {
  const { docs, pages, filters, layout, repaint, lang, onProgress, isActive } = o;
  const selected = pages.filter((p) => p.selected);
  if (selected.length === 0) throw new Error('No pages are selected.');

  const buffers = docs.map((d) => {
    const buf = docBuffers.get(d.id);
    if (!buf) throw new Error('Source file is no longer available — please re-upload.');
    return { id: d.id, data: buf };
  });

  // Booklet mode: 2-up landscape with saddle-stitch page order (padded
  // with blank cells to a multiple of 4).
  const useBooklet = layout.booklet;
  const effLayout: LayoutSettings = useBooklet
    ? { ...layout, rows: 1, cols: 2, orientation: 'landscape' }
    : layout;
  const overrides = o.overrides ?? {};
  const baseItems: ComposeItem[] = selected.map((p) => ({
    docId: p.docId,
    pageNumber: p.pageNumber,
    rotation: p.rotation,
    // attach the per-page override directly — rotation changes can never
    // orphan it (no key lookups)
    override: overrides[p.id],
  }));
  const items: ComposeItem[] = useBooklet
    ? buildBookletItems(baseItems)
    : baseItems;

  // LABS text repaint — OCR must run BEFORE compose so recognized words
  // can be re-typeset into canvases that replace the pdf page renders.
  // When "searchable" is also on, this ONE OCR pass feeds both consumers
  // (Tesseract never runs twice); repaint-only mode runs it just once too.
  // Per-slide OCR confidence report — collected from whichever pass ran.
  const ocrReports: OcrPageReport[] = [];
  const onPageReport = (r: OcrPageReport) => ocrReports.push(r);

  let sharedOcrWords: Map<string, OcrWord[]> | null = null;
  let sharedOcrError: Error | null = null;
  let sharedOcrRan = false;
  if (repaint) {
    sharedOcrRan = true;
    const total = countOcrSlides(items);
    onProgress({ done: 0, total, ocr: true });
    try {
      sharedOcrWords = await ocrComposeItems(
        buffers,
        items,
        (done, t) => onProgress({ done, total: t, ocr: true }),
        isActive,
        filters.ocrLangs ?? ['eng'],
        filters.ocrPsm ?? '3',
        onPageReport,
      );
    } catch (err) {
      if (!isActive()) throw new JobCancelled();
      console.error('OCR pass (repaint) failed:', err);
      sharedOcrError = err instanceof Error ? err : new Error('OCR pass failed');
    }
  }

  let repaintCanvases: Map<string, AnyCanvas> | null = null;
  if (repaint && sharedOcrWords) {
    try {
      repaintCanvases = await buildRepaintCanvases(
        buffers,
        items,
        sharedOcrWords,
        (done, t) => onProgress({ done, total: t, ocr: true }),
      );
    } catch (err) {
      if (!isActive()) throw new JobCancelled();
      console.error('Repaint canvas build failed:', err);
    }
  }

  // Batch cover page: one translated listing page ahead of the content.
  let coverSheetData: CoverSheetData | null = null;
  if (layout.coverSheet && !useBooklet) {
    const perDoc = new Map<number, number>();
    for (const p of selected) perDoc.set(p.docId, (perDoc.get(p.docId) ?? 0) + 1);
    coverSheetData = {
      title: 'Notes Printifier',
      subtitle: new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      contentsHeading: translateStatic('ly.cover.contents', lang),
      entries: docs.map((d) => ({
        name: d.name.replace(/\.pdf$/i, ''),
        label: translateStatic('ly.cover.pages', lang, { n: perDoc.get(d.id) ?? 0 }),
      })),
      footnote: translateStatic('ly.cover.footnote', lang),
    };
  }

  // compose pipeline (and pdf-lib) load on demand — keeps the initial
  // bundle light; the pipeline ships in its own async chunk.
  const { composePdf } = await import('./pdf/compose');
  // Recipe QR bytes are generated once (main thread) and reused across any
  // size-target recompress passes.
  const recipeQrPng = await buildRecipeQrPng(filters, layout);
  let composed = await composePdf({
    buffers,
    items,
    filters,
    layout: effLayout,
    repaintCanvases,
    coverSheetData,
    recipeQrPng,
    onProgress: (done, total) => onProgress({ done, total }),
  });
  // Repaint canvases were consumed by compose (and possibly transferred
  // to the worker) — let the map go out of scope, no manual dispose.
  repaintCanvases = null;

  // File-size target: if the user set a soft cap (e.g. 5 MB for a print
  // shop's upload form), re-compose with progressively lower JPEG quality
  // until the output fits (max 3 extra passes, floor 0.28).
  const targetMB =
    layout.sizeTargetMB && layout.sizeTargetMB > 0 ? layout.sizeTargetMB : null;
  let sizeAttempts = 0;
  if (targetMB) {
    const cap = targetMB * 1024 * 1024;
    let q = resolveQuality(effLayout).jpeg;
    while (composed.blob.size > cap && sizeAttempts < 3) {
      q = Math.max(0.28, Math.round(q * 72) / 100);
      sizeAttempts++;
      composed = await composePdf({
        buffers,
        items,
        filters,
        layout: effLayout,
        coverSheetData,
        recipeQrPng,
        jpegQualityOverride: q,
        onProgress: (done, total) => onProgress({ done, total }),
      });
    }
  }

  // Optional OCR pass — adds an invisible searchable text layer.
  let finalBlob = composed.blob;
  let searchable = false;
  let ocrWarning: string | null = null;
  if (filters.searchable) {
    try {
      // With repaint on, the pre-compose OCR pass already produced the
      // words — reuse them instead of running Tesseract again.
      let words: Map<string, OcrWord[]>;
      if (sharedOcrRan) {
        if (!sharedOcrWords) throw sharedOcrError ?? new Error('OCR pass failed');
        words = sharedOcrWords;
      } else {
        const total = countOcrSlides(items);
        onProgress({ done: 0, total, ocr: true });
        words = await ocrComposeItems(
          buffers,
          items,
          (done, t) => onProgress({ done, total: t, ocr: true }),
          isActive,
          filters.ocrLangs ?? ['eng'],
          filters.ocrPsm ?? '3',
          onPageReport,
        );
      }
      const withText = await addOcrTextLayer(composed.pdfBytes, items, composed.placements, words);
      finalBlob = new Blob([withText as BlobPart], { type: 'application/pdf' });
      searchable = true;
    } catch (err) {
      if (!isActive()) throw new JobCancelled();
      console.error('OCR pass failed:', err);
      ocrWarning =
        'Could not add the searchable text layer — your PDF was saved without it.';
    }
  }

  const inputBytes = docs.reduce((sum, d) => sum + d.size, 0);
  const result: Omit<ProcessResult, 'url'> = {
    outputBytes: finalBlob.size,
    outputPages: composed.outputPages,
    inputPages: selected.length,
    inputBytes,
    inkSavedPct: composed.inkSavedPct,
    beforeInkPct: composed.beforeInkPct,
    autoInverted: composed.autoInverted,
    searchable,
    repainted: composed.repainted,
    blankSkipped: composed.blankSkipped,
    ocrWarning,
    sizeTargetMB: targetMB,
    sizeAttempts,
    ocrReport:
      sharedOcrRan || searchable
        ? { pages: ocrReports, psm: filters.ocrPsm ?? '3' }
        : null,
  };
  const fileName =
    docs.map((d) => d.name).join(', ').slice(0, 300) || 'untitled.pdf';
  return { blob: finalBlob, result, fileName, selectedCount: selected.length };
}

/**
 * Fire-and-forget side effects shared by single & batch runs: anonymous
 * aggregate stats (truncated SHA-256 of the name — titles never leave the
 * device) + the private IndexedDB history for re-download / re-printify.
 */
export async function saveJobSideEffects(
  out: ComposeJobOutput,
  layoutLabel: string,
  colorMode: string,
  docs: DocInfo[],
): Promise<void> {
  // Fire-and-forget anonymous stats — server deployments only. File names
  // never leave the device — only a truncated SHA-256 of the joined name is
  // sent, so the server can still count unique documents but cannot read the
  // titles. Static builds (GitHub Pages / APK) ship no /api routes, so the
  // ping is skipped entirely instead of firing a doomed request.
  if (HAS_SERVER_API) {
    try {
      const digestBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(out.fileName),
      );
      const anonName = Array.from(new Uint8Array(digestBuf).slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      void fetch('/api/prints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: anonName,
          inputPages: out.result.inputPages,
          outputPages: out.result.outputPages,
          inputBytes: out.result.inputBytes,
          outputBytes: out.result.outputBytes,
          colorMode,
          layout: layoutLabel,
          inkSavedPct: out.result.inkSavedPct,
        }),
      }).catch(() => undefined);
    } catch {
      // stats are optional — never let them break processing
    }
  }

  // Private on-device history (IndexedDB) for quick re-download + re-run.
  // Originals (≤15 MB total) are kept too, so "Re-printify" can start a
  // fresh conversion from history without re-uploading anything.
  try {
    const jobId = await saveRecentJob({
      name: out.fileName,
      inputPages: out.result.inputPages,
      outputPages: out.result.outputPages,
      outputBytes: out.result.outputBytes,
      inkSavedPct: out.result.inkSavedPct,
      colorMode,
      layout: layoutLabel,
      blob: out.blob,
    });
    const sourceFiles: RecentSourceFile[] = docs
      .map((d) => {
        const buf = docBuffers.get(d.id);
        if (!buf || buf.byteLength === 0) return null;
        return {
          name: d.name || 'document.pdf',
          blob: new Blob([buf], { type: 'application/pdf' }),
        };
      })
      .filter((f): f is RecentSourceFile => f !== null);
    if (sourceFiles.length > 0) {
      void saveRecentSource(jobId, sourceFiles, out.result.inputBytes);
    }
  } catch (err) {
    console.error('History save failed:', err);
  }
}

interface PrintifyState {
  step: number; // 0 upload · 1 arrange · 2 enhance · 3 layout · 4 done
  docs: DocInfo[];
  pages: PageItem[];
  /**
   * Per-page filter overrides keyed by PageItem.id — e.g. keep one colorful
   * slide original while the rest of the deck inverts. Empty = no tweaks.
   */
  pageOverrides: Record<string, Partial<FilterSettings>>;
  /** The page the user last acted on — target for keyboard shortcuts. */
  activePageId: string | null;
  filters: FilterSettings;
  /** True once the user manually picked a color mode — disables auto mode. */
  filtersTouched: boolean;
  layout: LayoutSettings;
  loadingDocs: boolean;
  loadProgress: { done: number; total: number } | null;
  loadError: string | null;
  processing: boolean;
  progress: { done: number; total: number; ocr?: boolean } | null;
  processError: string | null;
  result: ProcessResult | null;

  /** LABS: persist Enhance + Layout choices on this device (off by default). */
  labsRemember: boolean;
  /** LABS: OCR pages and re-typeset them as crisp text instead of scans (off by default). */
  labsTextRepaint: boolean;

  /** Saved presets (localStorage-backed, hydrated on mount). */
  presets: Preset[];
  refreshPresets: () => void;
  savePreset: (name: string) => void;
  applyPreset: (id: string) => void;
  /** Apply an externally shared preset (share link ?p=…) without saving it. */
  applyPresetData: (filters: Partial<FilterSettings>, layout: Partial<LayoutSettings>) => void;
  deletePreset: (id: string) => void;

  addFiles: (files: File[]) => Promise<void>;
  /**
   * pdf.js render-diet: rasterize the given pages' thumbnails (300 px) if
   * they don't have one yet. Called by the arrange grid when placeholder
   * cells scroll into view — upload stays metadata-only, so a 300-page
   * deck opens instantly instead of blocking on 300 renders.
   */
  ensureThumbs: (pageIds: string[]) => Promise<void>;
  removeDoc: (docId: number) => void;
  togglePage: (pageId: string) => void;
  setAllSelected: (selected: boolean) => void;
  /** Quick picks — bulk selection by position: all / odd / even / invert / last10. */
  smartPick: (mode: 'all' | 'odd' | 'even' | 'invert' | 'last10') => void;
  /** Select ONLY the pages between two 1-based positions (slider + range input). */
  selectRange: (start1: number, end1: number) => void;
  /** Select ONLY the given 1-based positions (parsed "1-5, 8" input). */
  selectIndices: (positions: number[]) => void;
  /** Deselect (near-)blank pages. Returns how many were deselected. */
  skipBlankPages: () => Promise<number>;
  removePage: (pageId: string) => void;
  rotatePage: (pageId: string) => void;
  movePage: (from: number, to: number) => void;
  /** Remember the last-acted page (keyboard shortcut target). */
  setActivePageId: (pageId: string | null) => void;
  /** Set/clear one page's filter override (null patch = clear that page). */
  setPageOverride: (pageId: string, patch: Partial<FilterSettings> | null) => void;
  /** Drop every per-page override ("reset tweaks"). */
  clearPageOverrides: () => void;
  /**
   * Mixed-deck fix: rotate every page whose CONTENT is landscape into
   * portrait (and landscape-rotated portrait pages back), so a portrait
   * output grid uses full cells instead of letterboxing. Returns the count.
   */
  autoRotateMixed: () => number;
  setFilters: (patch: Partial<FilterSettings>) => void;
  setLayout: (patch: Partial<LayoutSettings>) => void;
  setStep: (step: number) => void;
  setLabsRemember: (on: boolean) => void;
  setLabsTextRepaint: (on: boolean) => void;
  /** LABS: restore the labs flag + saved prefs from localStorage (mount-time, client only). */
  hydrateLabs: () => void;
  process: () => Promise<void>;
  reset: () => void;
}

export const usePrintifyStore = create<PrintifyState>((set, get) => ({
  step: 0,
  docs: [],
  pages: [],
  pageOverrides: {},
  activePageId: null,
  filters: defaultFilters,
  filtersTouched: false,
  layout: defaultLayout,
  loadingDocs: false,
  loadProgress: null,
  loadError: null,
  processing: false,
  progress: null,
  processError: null,
  result: null,

  labsRemember: false,
  labsTextRepaint: false,

  presets: [],

  refreshPresets: () => set({ presets: allPresets() }),

  savePreset: (name) => {
    const preset: Preset = {
      id: makePresetId(),
      name: (name.trim() || 'My preset').slice(0, 40),
      ts: Date.now(),
      filters: get().filters,
      layout: get().layout,
    };
    const list = [preset, ...loadPresets()].slice(0, MAX_PRESETS);
    savePresetsToDisk(list);
    set({ presets: list });
  },

  applyPreset: (id) => {
    const p = get().presets.find((x) => x.id === id);
    if (!p) return;
    set({
      filters: { ...defaultFilters, ...p.filters },
      layout: { ...defaultLayout, ...p.layout },
      filtersTouched: true,
    });
    if (get().labsRemember) savePrefs(get().filters, get().layout);
  },

  applyPresetData: (filters, layout) => {
    set({
      filters: { ...defaultFilters, ...filters },
      layout: { ...defaultLayout, ...layout },
      filtersTouched: true,
    });
    if (get().labsRemember) savePrefs(get().filters, get().layout);
  },

  deletePreset: (id) => {
    if (id.startsWith('builtin:')) return; // built-ins are permanent
    const list = loadPresets().filter((p) => p.id !== id);
    savePresetsToDisk(list);
    set({ presets: allPresets() });
  },

  addFiles: async (files) => {
    const pdfFiles: File[] = [];
    const imageFiles: File[] = files.filter((f) => isImageFile(f));
    for (const f of files) {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(f);
      } else if (!isImageFile(f)) {
        continue; // neither PDF nor image — ignored
      }
    }
    if (pdfFiles.length === 0 && imageFiles.length === 0) {
      set({ loadError: 'Please choose PDF or image files only.' });
      return;
    }
    set({ loadingDocs: true, loadError: null, loadProgress: { done: 0, total: pdfFiles.length + (imageFiles.length > 0 ? 1 : 0) } });

    const docs: DocInfo[] = [...get().docs];
    const pages: PageItem[] = [...get().pages];
    let done = 0;

    try {
      // Images → one merged PDF document (one page per image), which then
      // flows through the exact same pipeline as an uploaded PDF.
      if (imageFiles.length > 0) {
        const bytes = await imagesToPdfBytes(imageFiles);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const doc = await loadPdfDocument(buffer);
        const docId = nextDocId++;
        docBuffers.set(docId, buffer);
        docs.push({
          id: docId,
          name: `photos-${imageFiles.length}-img.pdf`,
          size: buffer.byteLength,
          pageCount: doc.numPages,
        });
        // Metadata-only: dimensions from the parsed doc, thumbnails lazily
        // rasterized by the arrange grid (ensureThumbs) as cells appear.
        for (let p = 1; p <= doc.numPages; p++) {
          const dims = await getPageDimensions(doc, p);
          pages.push({
            id: `d${docId}p${p}`,
            docId,
            pageNumber: p,
            rotation: 0,
            selected: true,
            thumb: null,
            widthPt: dims.width,
            heightPt: dims.height,
          });
        }
        done++;
        set({ loadProgress: { done, total: pdfFiles.length + 1 }, docs: [...docs], pages: [...pages] });
      }

      for (const file of pdfFiles) {
        const buffer = await file.arrayBuffer();
        const doc = await loadPdfDocument(buffer);
        const docId = nextDocId++;
        docBuffers.set(docId, buffer);

        // Smart default: the built-in preset targets dark slide decks
        // (invert). For light, white-background documents that would print
        // near-black pages, so fall back to 'original' + stain cleanup —
        // but only until the user actively picks a mode themselves.
        if (!get().filtersTouched) {
          const first = await renderPageToCanvas(doc, 1, { targetWidth: 220 });
          const isLightDoc = meanLuminance(first) > 190;
          if (isLightDoc && get().filters.colorMode === 'invert') {
            set({ filters: { ...get().filters, colorMode: 'original' } });
          }
        }

        docs.push({
          id: docId,
          name: file.name,
          size: file.size,
          pageCount: doc.numPages,
        });

        // pdf.js render-diet: upload only parses metadata (page count +
        // dimensions). The eager 300 px render of EVERY page was the single
        // biggest upload-time cost (~100–300 ms/page → half a minute on a
        // 200-page deck before Continue appeared). Thumbnails now rasterize
        // lazily as their grid cells scroll into view (ensureThumbs); the
        // processing pipeline never consumed thumbs.
        for (let p = 1; p <= doc.numPages; p++) {
          const dims = await getPageDimensions(doc, p);
          pages.push({
            id: `d${docId}p${p}`,
            docId,
            pageNumber: p,
            rotation: 0,
            selected: true,
            thumb: null,
            widthPt: dims.width,
            heightPt: dims.height,
          });
        }
        done++;
        set({ loadProgress: { done, total: pdfFiles.length }, docs: [...docs], pages: [...pages] });
      }
      set({ loadingDocs: false, loadProgress: null, step: 1 });
    } catch (err) {
      console.error('Failed to load PDF:', err);
      set({
        loadingDocs: false,
        loadProgress: null,
        loadError:
          'Could not read that PDF. It may be corrupted or password-protected.',
      });
    }
  },

  ensureThumbs: async (pageIds) => {
    if (pageIds.length === 0) return;
    const targets = get().pages.filter(
      (p) => pageIds.includes(p.id) && p.thumb === null && !thumbJobs.has(p.id),
    );
    if (targets.length === 0) return;
    for (const t of targets) thumbJobs.add(t.id);
    try {
      // group the requested pages per document, render each missing thumb
      const byDoc = new Map<number, typeof targets>();
      for (const t of targets) {
        const list = byDoc.get(t.docId) ?? [];
        list.push(t);
        byDoc.set(t.docId, list);
      }
      for (const [docId, items] of byDoc) {
        try {
          const doc = await getPdfDoc(docId);
          if (!doc) continue;
          const fixes = new Map<string, string>();
          for (const item of items) {
            // One rasterization slot per page — bounded main-thread blit/encode
            // work no matter how many IO batches land at once.
            const release = await acquireThumbSlot();
            try {
              let canvas = await renderPageToCanvas(doc, item.pageNumber, {
                targetWidth: 300,
              });
              if (canvasLooksLikeFailedRender(canvas)) {
                // A dependent (JPX) image may not have been decoded yet at
                // small scales — retry, escalating resolution until it does.
                for (const w of [620, 900]) {
                  await new Promise((r) => setTimeout(r, 200));
                  const retry = await renderPageToCanvas(doc, item.pageNumber, {
                    targetWidth: w,
                  });
                  if (!canvasLooksLikeFailedRender(retry)) {
                    canvas = retry;
                    break;
                  }
                }
              }
              fixes.set(item.id, canvasToDataUrl(canvas, 'image/jpeg', 0.55));
            } catch {
              // this page failed to rasterize — placeholder stays, a later
              // intersection retry can pick it up again
            } finally {
              release();
            }
          }
          if (fixes.size > 0) {
            set((st) => ({
              pages: st.pages.map((p) => {
                const t = fixes.get(p.id);
                return t ? { ...p, thumb: t } : p;
              }),
            }));
          }
        } catch {
          // document unreadable — placeholders stay
        }
      }
    } finally {
      for (const t of targets) thumbJobs.delete(t.id);
    }
  },

  removeDoc: (docId) => {
    docBuffers.delete(docId);
    pdfDocs.delete(docId);
    set((s) => ({
      docs: s.docs.filter((d) => d.id !== docId),
      pages: s.pages.filter((p) => p.docId !== docId),
    }));
  },

  togglePage: (pageId) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, selected: !p.selected } : p,
      ),
    })),

  setAllSelected: (selected) =>
    set((s) => ({
      pages: s.pages.map((p) => ({ ...p, selected, blank: false })),
    })),

  smartPick: (mode) =>
    set((s) => {
      const n = s.pages.length;
      return {
        pages: s.pages.map((p, i) => {
          let selected: boolean;
          switch (mode) {
            case 'all':
              selected = true;
              break;
            case 'odd':
              selected = i % 2 === 0; // 1st, 3rd, … (1-based odd positions)
              break;
            case 'even':
              selected = i % 2 === 1;
              break;
            case 'invert':
              selected = !p.selected;
              break;
            case 'last10':
              selected = i >= n - 10;
              break;
          }
          return selected === p.selected ? p : { ...p, selected };
        }),
      };
    }),

  selectRange: (start1, end1) =>
    set((s) => {
      const n = s.pages.length;
      const a = Math.max(1, Math.min(start1, end1, n));
      const b = Math.min(n, Math.max(start1, end1, 1));
      return {
        pages: s.pages.map((p, i) => {
          const selected = i >= a - 1 && i <= b - 1;
          return selected === p.selected ? p : { ...p, selected };
        }),
      };
    }),

  selectIndices: (positions) =>
    set((s) => {
      const wanted = new Set(
        positions
          .map((p1) => Math.round(p1) - 1)
          .filter((i) => i >= 0 && i < s.pages.length),
      );
      return {
        pages: s.pages.map((p, i) => {
          const selected = wanted.has(i);
          return selected === p.selected ? p : { ...p, selected };
        }),
      };
    }),

  skipBlankPages: async () => {
    const pages = get().pages;

    // Pass 1: cheap scan of the stored thumbnails. Pages whose thumb hasn't
    // been lazily rasterized yet can't be judged here — they join pass 2's
    // fresh-render verification (which also fills their thumb).
    const suspicious: PageItem[] = [];
    for (const p of pages) {
      if (!p.selected) continue;
      if (p.thumb === null) {
        suspicious.push(p);
        continue;
      }
      try {
        const frac = await thumbInkFraction(p.thumb);
        if (frac < 0.012) suspicious.push(p);
      } catch {
        // undecodable thumb — keep the page
      }
    }

    // Pass 2: thumbnails occasionally render blank due to a pdf.js quirk
    // (dependent image not decoded at small scales). Re-verify every
    // suspicious page with a fresh, higher-resolution render before
    // deselecting; if the fresh render recovers, also fix the stale thumb.
    const flagged = new Set<string>();
    const thumbFixes = new Map<string, string>();
    for (const p of suspicious) {
      const buf = docBuffers.get(p.docId);
      if (!buf) {
        flagged.add(p.id);
        continue;
      }
      try {
        const doc = await loadPdfDocument(buf);
        const canvas = await renderPageToCanvas(doc, p.pageNumber, {
          targetWidth: 620,
        });
        // the fresh render doubles as the page's (previously missing) thumb
        if (p.thumb === null) {
          thumbFixes.set(p.id, canvasToDataUrl(canvas, 'image/jpeg', 0.55));
        }
        if (canvasDarkFraction(canvas) < 0.012) {
          flagged.add(p.id);
        } else if (p.thumb !== null) {
          // recovered — also repair the broken thumbnail in the UI
          thumbFixes.set(p.id, canvasToDataUrl(canvas, 'image/jpeg', 0.55));
        }
      } catch {
        flagged.add(p.id);
      }
    }

    // safety: never deselect everything
    const remaining = pages.filter(
      (p) => p.selected && !flagged.has(p.id),
    ).length;
    if (remaining === 0) return 0;
    set((s) => ({
      pages: s.pages.map((p) =>
        flagged.has(p.id)
          ? { ...p, selected: false, blank: true }
          : thumbFixes.has(p.id)
            ? { ...p, thumb: thumbFixes.get(p.id)! }
            : p,
      ),
    }));
    return flagged.size;
  },

  removePage: (pageId) =>
    set((s) => ({
      pages: s.pages.filter((p) => p.id !== pageId),
      pageOverrides: Object.fromEntries(
        Object.entries(s.pageOverrides).filter(([k]) => k !== pageId),
      ),
      activePageId: s.activePageId === pageId ? null : s.activePageId,
    })),

  rotatePage: (pageId) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    })),

  setActivePageId: (pageId) => set({ activePageId: pageId }),

  setPageOverride: (pageId, patch) =>
    set((s) => {
      const next = { ...s.pageOverrides };
      if (patch === null || Object.keys(patch).length === 0) delete next[pageId];
      else next[pageId] = { ...next[pageId], ...patch };
      return { pageOverrides: next };
    }),

  clearPageOverrides: () => set({ pageOverrides: {} }),

  autoRotateMixed: () => {
    let rotated = 0;
    set((s) => ({
      pages: s.pages.map((p) => {
        // content aspect as it renders RIGHT NOW (user rotation applied)
        const rotatedQuarter = p.rotation % 180 === 90;
        const effW = rotatedQuarter ? p.heightPt : p.widthPt;
        const effH = rotatedQuarter ? p.widthPt : p.heightPt;
        if (effW > effH * 1.02) {
          // landscape content in a portrait batch → turn it upright
          rotated++;
          return { ...p, rotation: (p.rotation + 90) % 360 };
        }
        return p;
      }),
    }));
    return rotated;
  },

  movePage: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.pages.length || to >= s.pages.length)
        return {};
      const next = [...s.pages];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { pages: next };
    }),

  setFilters: (patch) => {
    set((s) => ({
      filters: { ...s.filters, ...patch },
      filtersTouched: s.filtersTouched || 'colorMode' in patch,
    }));
    if (get().labsRemember) savePrefs(get().filters, get().layout);
  },
  setLayout: (patch) => {
    set((s) => ({ layout: { ...s.layout, ...patch } }));
    if (get().labsRemember) savePrefs(get().filters, get().layout);
  },
  setStep: (step) => set({ step }),
  setLabsRemember: (on) => {
    set({ labsRemember: on });
    saveRememberFlag(on);
    if (on) savePrefs(get().filters, get().layout);
  },
  setLabsTextRepaint: (on) => {
    set({ labsTextRepaint: on });
    saveTextRepaintFlag(on);
  },
  hydrateLabs: () => {
    // Text repaint is an independent flag — restore it even when the user
    // never opted into "remember my settings".
    const repaint = loadTextRepaintFlag();
    if (!loadRememberFlag()) {
      if (repaint) set({ labsTextRepaint: true });
      return;
    }
    const prefs = loadSavedPrefs();
    set((s) => ({
      labsRemember: true,
      labsTextRepaint: repaint,
      filters:
        prefs?.filters && typeof prefs.filters === 'object'
          ? migrateFilters({
              ...s.filters,
              ...(prefs.filters as Partial<FilterSettings>),
            })
          : s.filters,
      layout:
        prefs?.layout && typeof prefs.layout === 'object'
          ? { ...s.layout, ...(prefs.layout as Partial<LayoutSettings>) }
          : s.layout,
      // restored choices count as “touched” so the per-document auto preset
      // never overrides what the user deliberately saved
      filtersTouched: prefs?.filters ? true : s.filtersTouched,
    }));
  },

  process: async () => {
    const { docs, pages, filters, layout, labsTextRepaint, pageOverrides } = get();
    const selected = pages.filter((p) => p.selected);
    if (selected.length === 0 || docs.length === 0) return;

    set({ processing: true, processError: null, progress: { done: 0, total: selected.length } });
    try {
      // Force a paint so the progress bar appears before heavy work starts.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

      const out = await runComposeJob({
        docs,
        pages,
        overrides: pageOverrides,
        filters,
        layout,
        repaint: labsTextRepaint,
        lang: useLangStore.getState().lang,
        onProgress: (p) => set({ progress: p }),
        isActive: () => get().processing,
      });
      if (!get().processing) return; // cancelled mid-run

      const url = URL.createObjectURL(out.blob);
      const result: ProcessResult = { ...out.result, url };
      // Impact meter BEFORE the step switch — ResultStep reads the totals on
      // mount, and recordJob is a cheap synchronous localStorage write while
      // the IndexedDB history saves below are async.
      recordJob({
        inputPages: out.selectedCount,
        outputPages: out.result.outputPages,
        inkSavedPct: out.result.inkSavedPct,
        beforeInkPct: out.result.beforeInkPct,
      });
      set({ processing: false, progress: null, result, step: 4 });

      // Fire-and-forget: anonymous stats + private on-device history.
      const layoutLabel = layout.booklet
        ? 'booklet'
        : `${layout.rows}x${layout.cols}`;
      void saveJobSideEffects(out, layoutLabel, filters.colorMode, docs);
    } catch (err) {
      if (err instanceof JobCancelled || !get().processing) return; // reset mid-run
      console.error('Processing failed:', err);
      set({
        processing: false,
        progress: null,
        processError:
          err instanceof Error ? err.message : 'Something went wrong while processing.',
      });
    }
  },

  reset: () => {
    const { result } = get();
    if (result?.url) URL.revokeObjectURL(result.url);
    docBuffers.clear();
    nextDocId = 1;
    set({
      step: 0,
      docs: [],
      pages: [],
      pageOverrides: {},
      activePageId: null,
      filters: defaultFilters,
      filtersTouched: false,
      loadingDocs: false,
      loadProgress: null,
      loadError: null,
      processing: false,
      progress: null,
      processError: null,
      result: null,
    });
  },
}));

// Re-exported so the Layout step can reuse the exact same math.
export { estimateOutputPages };
