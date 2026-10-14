import { type PdfDocument } from './pdfjs';

export interface RenderOptions {
  /** Render so that the canvas is ~this many CSS pixels wide. */
  targetWidth?: number;
  /** Explicit pdf.js scale (overrides targetWidth). */
  scale?: number;
  /** Extra user rotation in degrees (0/90/180/270), applied on top of the page's own rotation. */
  extraRotation?: number;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // floor, not ceil: the canvas must never exceed the viewport rect pdf.js
  // paints — an unpainted overflow line shows as a hairline artifact (and
  // inverts to black in the composed output).
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

/**
 * Render one PDF page (1-based pageNumber) into an offscreen canvas.
 * The canvas is pre-filled with white so transparent PDF backgrounds
 * do not turn black when later encoded as JPEG.
 */
export async function renderPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  opts: RenderOptions = {},
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });

  const scale =
    opts.scale ?? (opts.targetWidth ? opts.targetWidth / base.width : 1);
  const rotation =
    opts.extraRotation && opts.extraRotation > 0
      ? (base.rotation + opts.extraRotation) % 360
      : undefined;

  const viewport = page.getViewport({ scale, rotation });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Page size in PDF points (at scale 1) plus its own rotation. */
export async function getPageDimensions(
  doc: PdfDocument,
  pageNumber: number,
): Promise<{ width: number; height: number; rotation: number }> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  return { width: vp.width, height: vp.height, rotation: vp.rotation };
}

export function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.6,
): string {
  return canvas.toDataURL(type, quality);
}
