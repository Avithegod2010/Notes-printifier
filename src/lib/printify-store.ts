import { create } from 'zustand';
import { loadPdfDocument } from './pdf/pdfjs';
import { renderPageToCanvas, canvasToDataUrl, getPageDimensions } from './pdf/render';
import {
  defaultFilters,
  type FilterSettings,
} from './pdf/filters';
import {
  buildBookletItems,
  composePdf,
  defaultLayout,
  type ComposeItem,
  type LayoutSettings,
} from './pdf/compose';
import { saveRecentJob } from './recent-jobs';

export interface DocInfo {
  id: number;
  name: string;
  size: number;
  pageCount: number;
}

export interface PageItem {
  id: string;
  docId: number;
  pageNumber: number;
  rotation: number;
  selected: boolean;
  thumb: string;
  widthPt: number;
  heightPt: number;
  /** Detected as (near-)blank — shown as a badge, skipped by "Skip blank". */
  blank?: boolean;
}

export interface ProcessResult {
  url: string;
  outputBytes: number;
  outputPages: number;
  inputPages: number;
  inputBytes: number;
  inkSavedPct: number;
  beforeInkPct: number;
}

/** Raw PDF bytes — kept outside zustand (not serializable, potentially large). */
const docBuffers = new Map<number, ArrayBuffer>();
let nextDocId = 1;

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

interface PrintifyState {
  step: number; // 0 upload · 1 arrange · 2 enhance · 3 layout · 4 done
  docs: DocInfo[];
  pages: PageItem[];
  filters: FilterSettings;
  /** True once the user manually picked a color mode — disables auto mode. */
  filtersTouched: boolean;
  layout: LayoutSettings;
  loadingDocs: boolean;
  loadProgress: { done: number; total: number } | null;
  loadError: string | null;
  processing: boolean;
  progress: { done: number; total: number } | null;
  processError: string | null;
  result: ProcessResult | null;

  addFiles: (files: File[]) => Promise<void>;
  removeDoc: (docId: number) => void;
  togglePage: (pageId: string) => void;
  setAllSelected: (selected: boolean) => void;
  /** Deselect (near-)blank pages. Returns how many were deselected. */
  skipBlankPages: () => Promise<number>;
  removePage: (pageId: string) => void;
  rotatePage: (pageId: string) => void;
  movePage: (from: number, to: number) => void;
  setFilters: (patch: Partial<FilterSettings>) => void;
  setLayout: (patch: Partial<LayoutSettings>) => void;
  setStep: (step: number) => void;
  process: () => Promise<void>;
  reset: () => void;
}

export const usePrintifyStore = create<PrintifyState>((set, get) => ({
  step: 0,
  docs: [],
  pages: [],
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

  addFiles: async (files) => {
    const pdfFiles = files.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (pdfFiles.length === 0) {
      set({ loadError: 'Please choose PDF files only.' });
      return;
    }
    set({ loadingDocs: true, loadError: null, loadProgress: { done: 0, total: pdfFiles.length } });

    const docs: DocInfo[] = [...get().docs];
    const pages: PageItem[] = [...get().pages];
    let done = 0;

    try {
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

        for (let p = 1; p <= doc.numPages; p++) {
          let canvas = await renderPageToCanvas(doc, p, { targetWidth: 300 });
          if (canvasLooksLikeFailedRender(canvas)) {
            // A dependent (JPX) image may not have been decoded yet at small
            // scales — retry, escalating resolution until it decodes.
            for (const w of [620, 900]) {
              await new Promise((r) => setTimeout(r, 200));
              const retry = await renderPageToCanvas(doc, p, { targetWidth: w });
              if (!canvasLooksLikeFailedRender(retry)) {
                canvas = retry;
                break;
              }
            }
          }
          const dims = await getPageDimensions(doc, p);
          pages.push({
            id: `d${docId}p${p}`,
            docId,
            pageNumber: p,
            rotation: 0,
            selected: true,
            thumb: canvasToDataUrl(canvas, 'image/jpeg', 0.55),
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

  removeDoc: (docId) => {
    docBuffers.delete(docId);
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

  skipBlankPages: async () => {
    const pages = get().pages;

    // Pass 1: cheap scan of the stored thumbnails.
    const suspicious: PageItem[] = [];
    for (const p of pages) {
      if (!p.selected) continue;
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
        if (canvasDarkFraction(canvas) < 0.012) {
          flagged.add(p.id);
        } else {
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
    set((s) => ({ pages: s.pages.filter((p) => p.id !== pageId) })),

  rotatePage: (pageId) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === pageId ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
      ),
    })),

  movePage: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.pages.length || to >= s.pages.length)
        return {};
      const next = [...s.pages];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { pages: next };
    }),

  setFilters: (patch) =>
    set((s) => ({
      filters: { ...s.filters, ...patch },
      filtersTouched: s.filtersTouched || 'colorMode' in patch,
    })),
  setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),
  setStep: (step) => set({ step }),

  process: async () => {
    const { docs, pages, filters, layout } = get();
    const selected = pages.filter((p) => p.selected);
    if (selected.length === 0 || docs.length === 0) return;

    set({ processing: true, processError: null, progress: { done: 0, total: selected.length } });
    try {
      // Force a paint so the progress bar appears before heavy work starts.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

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
      const baseItems: ComposeItem[] = selected.map((p) => ({
        docId: p.docId,
        pageNumber: p.pageNumber,
        rotation: p.rotation,
      }));
      const items: ComposeItem[] = useBooklet
        ? buildBookletItems(baseItems)
        : baseItems;

      const { blob, outputPages, inkSavedPct, beforeInkPct } = await composePdf({
        buffers,
        items,
        filters,
        layout: effLayout,
        onProgress: (done, total) => set({ progress: { done, total } }),
      });

      const url = URL.createObjectURL(blob);
      const inputBytes = docs.reduce((sum, d) => sum + d.size, 0);
      const result: ProcessResult = {
        url,
        outputBytes: blob.size,
        outputPages,
        inputPages: selected.length,
        inputBytes,
        inkSavedPct,
        beforeInkPct,
      };
      set({ processing: false, progress: null, result, step: 4 });

      const layoutLabel = useBooklet
        ? 'booklet'
        : `${effLayout.rows}x${effLayout.cols}`;
      const fileName =
        docs.map((d) => d.name).join(', ').slice(0, 300) || 'untitled.pdf';

      // Fire-and-forget anonymous stats
      void fetch('/api/prints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          inputPages: selected.length,
          outputPages,
          inputBytes,
          outputBytes: blob.size,
          colorMode: filters.colorMode,
          layout: layoutLabel,
          inkSavedPct,
        }),
      }).catch(() => undefined);

      // Private on-device history (IndexedDB) for quick re-download
      void saveRecentJob({
        name: fileName,
        inputPages: selected.length,
        outputPages,
        outputBytes: blob.size,
        inkSavedPct,
        colorMode: filters.colorMode,
        layout: layoutLabel,
        blob,
      });
    } catch (err) {
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
