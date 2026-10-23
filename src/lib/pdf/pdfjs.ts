/**
 * Lazy loader for pdf.js. Must only ever be called from client code
 * (event handlers / effects) so it never runs during SSR.
 */

type PdfjsModule = typeof import('pdfjs-dist');

/**
 * Where the pdf.js worker finds its wasm modules. Without it, JPEG2000 (JPX)
 * and JBIG2 images silently fail to decode and their pages render blank —
 * the wasm bundles live in public/pdfjs/wasm (copied from pdfjs-dist).
 */
/** GitHub Pages subpath prefix ('' on root deployments / the APK). */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const PDF_WASM_URL = `${BASE}/pdfjs/wasm/`;

let cached: PdfjsModule | null = null;

export async function getPdfjs(): Promise<PdfjsModule> {
  if (!cached) {
    const lib = await import('pdfjs-dist');
    lib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.mjs`;
    cached = lib;
  }
  return cached;
}

/** A loaded pdf.js document (inferred straight from the lib to avoid a circular alias). */
export type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;

/**
 * Load a PDF from raw bytes. `data.slice(0)` matters: pdf.js transfers the
 * buffer to its worker, which would detach the original ArrayBuffer and
 * break any later re-use (final render pass reuses the same buffers).
 */
export async function loadPdfDocument(data: ArrayBuffer): Promise<PdfDocument> {
  const pdfjs = await getPdfjs();
  const copy = new Uint8Array(data.slice(0));
  return pdfjs.getDocument({ data: copy, wasmUrl: PDF_WASM_URL }).promise;
}

// ---------------------------------------------------------------------------
// URL-keyed document cache — the "same doc cache" the app keeps for uploaded
// files (pdfDocs in printify-store), extended to PDFs loaded by URL (the
// example dialog's bundled before/after samples). Without it every dialog
// open re-fetches AND re-parses both PDFs; with it, reopening is instant.
// ---------------------------------------------------------------------------

export interface UrlPdfDoc {
  doc: PdfDocument;
  /** Byte size of the source file (for the dialog's size badges). */
  bytes: number;
  /** Release the pdf.js worker memory (only called by cache eviction). */
  destroy: () => void;
}

const URL_DOC_LIMIT = 4;
const urlDocs = new Map<string, Promise<UrlPdfDoc>>();

/**
 * Load (or fetch from cache) a PDF served from a URL. Concurrent calls for
 * the same URL share one load; failed loads are not cached.
 */
export function loadPdfDocumentFromUrl(url: string): Promise<UrlPdfDoc> {
  const hit = urlDocs.get(url);
  if (hit) return hit;

  const entry = (async (): Promise<UrlPdfDoc> => {
    const pdfjs = await getPdfjs();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    const buf = await res.arrayBuffer();
    // data.slice(0): pdf.js transfers the buffer to its worker — never hand
    // it our only copy (same rule as loadPdfDocument).
    const task = pdfjs.getDocument({
      data: new Uint8Array(buf.slice(0)),
      wasmUrl: PDF_WASM_URL,
    });
    const doc = await task.promise;
    return {
      doc,
      bytes: buf.byteLength,
      destroy: () => {
        // pdf.js v6 removed PDFDocumentProxy.destroy() — cleanup goes
        // through the PDFDocumentLoadingTask returned by getDocument().
        try {
          void task.destroy();
        } catch {
          // already destroyed
        }
      },
    };
  })();

  urlDocs.set(url, entry);
  entry
    .then(() => {
      // Simple FIFO cap — the cache only ever holds the demo PDFs in
      // practice; eviction just keeps a pathological session bounded.
      while (urlDocs.size > URL_DOC_LIMIT) {
        const oldest = urlDocs.keys().next().value as string | undefined;
        if (!oldest || oldest === url) break;
        const evicted = urlDocs.get(oldest);
        urlDocs.delete(oldest);
        evicted?.then((e) => e.destroy()).catch(() => undefined);
      }
    })
    .catch(() => {
      // don't cache failures — the next call retries the fetch
      if (urlDocs.get(url) === entry) urlDocs.delete(url);
    });
  return entry;
}
