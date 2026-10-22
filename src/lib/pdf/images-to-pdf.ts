/**
 * images-to-pdf.ts — phone photos / scanned images → one multi-page PDF.
 *
 * Part of the PDF↔images feature: the upload step accepts JPG/PNG/WebP files,
 * converts each to a full-page image inside a single PDF (via canvas, so
 * every browser-decodable format works), and that PDF then flows through the
 * exact same printify pipeline as a normal document.
 *
 * Page geometry: each image becomes one page sized at 96 dpi (px × 0.75 →
 * pt), clamped so no page exceeds ~1 m. The compose pipeline scales slides
 * into the output grid anyway — these page sizes only matter for aspect and
 * "Original size" mode.
 */

import { PDFDocument } from 'pdf-lib';

const PX_TO_PT = 72 / 96; // 96 dpi images → 72 dpi PDF points
const MAX_PT = 2880; // ~101 cm — pdf-lib/printers hate absurd page boxes

/** Decode any browser-supported image file to JPEG bytes via canvas. */
async function imageFileToJpeg(
  file: Blob,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement('canvas');
    // Cap the long edge at 2400 px — plenty for print at the sizes used,
    // keeps memory and JPEG size sane for 12 MP phone photos.
    const scale = Math.min(1, 2400 / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('Image encode failed');
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    bitmap.close();
  }
}

export function isImageFile(f: File): boolean {
  return (
    f.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name)
  );
}

/**
 * Build one PDF from image files, one page per image, in the given order.
 * Returns the PDF bytes + per-page count (always 1 page per image).
 */
export async function imagesToPdfBytes(files: File[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const { bytes, width, height } = await imageFileToJpeg(file);
    const img = await out.embedJpg(bytes);
    let pw = width * PX_TO_PT;
    let ph = height * PX_TO_PT;
    const over = Math.max(pw / MAX_PT, ph / MAX_PT);
    if (over > 1) {
      pw /= over;
      ph /= over;
    }
    const page = out.addPage([Math.max(36, pw), Math.max(36, ph)]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }
  return out.save();
}
