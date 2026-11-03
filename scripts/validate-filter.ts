/** Validate the new stain-removal rules on real rendered pages. */
import { createCanvas, loadImage } from '@napi-rs/canvas';

const CYAN_LUM_CUT = 182;
const TINT_LUM_CUT = 200;

function isStainPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  if (diff < 8) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (diff >= 12 && b > r + 12 && b >= g - 4 && lum >= CYAN_LUM_CUT) return true;
  if (diff <= 75 && lum >= TINT_LUM_CUT) return true;
  return false;
}

function levels(v: number, blackCut: number, whiteCut: number): number {
  if (v <= blackCut) return 0;
  if (v >= whiteCut) return 255;
  return ((v - blackCut) * 255) / (whiteCut - blackCut);
}

async function apply(page: number, mode: 'original' | 'grayscale' | 'bw') {
  const img = await loadImage(`/tmp/pdfpages/page-${page}.png`);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const strength = 0.45;
  const whiteCut = 255 - strength * 90;
  const blackCut = strength * 55;
  let killed = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) {
    total++;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (isStainPixel(r, g, b)) {
      r = g = b = 255; killed++;
    } else if (mode !== 'original') {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = mode === 'bw' ? (y >= 128 ? 255 : 0) : y;
    }
    r = levels(r, blackCut, whiteCut);
    g = levels(g, blackCut, whiteCut);
    b = levels(b, blackCut, whiteCut);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(imageData, 0, 0);
  console.log(`page ${page} [${mode}]: killed ${(100 * killed / total).toFixed(1)}% of pixels as stains`);
  await Bun.write(`/tmp/pdfpages/after-${page}-${mode}.png`, canvas.toBuffer('image/png'));
}

await apply(1, 'original');
await apply(2, 'original');
await apply(8, 'original');
await apply(4, 'original');
await apply(2, 'bw');
