/** Analyze the user's own output (upload/notes-printifier.pdf):
 * render pages, scan for blue-ish pixels, and inspect cell borders. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync } from 'node:fs';

const OUT = '/home/z/my-project/upload/notes-printifier.pdf';
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

class NodeCanvasFactory {
  create(width: number, height: number) {
    const c = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas: c, context: c.getContext('2d') as CanvasRenderingContext2D };
  }
  reset(ctx: { canvas: unknown }, width: number, height: number) {
    (ctx.canvas as { width: number; height: number }).width = width;
    (ctx.canvas as { width: number; height: number }).height = height;
  }
  destroy(ctx: { canvas: unknown }) {
    (ctx.canvas as { width: number; height: number }).width = 0;
    (ctx.canvas as { width: number; height: number }).height = 0;
  }
}

const data = new Uint8Array(await (await import('node:fs/promises')).readFile(OUT));
const doc = await pdfjs.getDocument({ data, canvasFactory: new NodeCanvasFactory(), isEvalSupported: false }).promise;
console.log('output pages:', doc.numPages);

mkdirSync('/tmp/userout', { recursive: true });

for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvasFactory: new NodeCanvasFactory() } as never).promise;
  page.cleanup();
  await Bun.write(`/tmp/userout/page-${p}.png`, canvas.toBuffer('image/png'));

  // Scan for blue-ish pixels (b noticeably above r and g)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const buckets = new Map<string, number>();
  let blueish = 0;
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    total++;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (b > r + 12 && b > g + 6 && lum < 235) {
      blueish++;
      const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  console.log(`\npage ${p}: ${canvas.width}x${canvas.height}, blueish px: ${blueish} (${((blueish / total) * 100).toFixed(2)}%)`);
  const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, v] of top) console.log('   rgb≈', k, 'x', v);
}
console.log('\ndone');
