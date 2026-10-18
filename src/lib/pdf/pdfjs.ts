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
