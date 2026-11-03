/** Render the final output PDF pages for visual verification. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync } from 'node:fs';

const OUT = '/home/z/Downloads/notes-printifier.pdf';
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

mkdirSync('/tmp/outpages', { recursive: true });
for (const p of [1, 2, 3]) {
  if (p > doc.numPages) continue;
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1.3 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvasFactory: new NodeCanvasFactory() } as never).promise;
  page.cleanup();
  await Bun.write(`/tmp/outpages/out-${p}.png`, canvas.toBuffer('image/png'));
  console.log(`rendered page ${p}`);
}
