/** Render sample-printified.pdf pages for visual check. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

class NodeCanvasFactory {
  create(width: number, height: number) {
    const c = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas: c, context: c.getContext('2d') as CanvasRenderingContext2D };
  }
  reset(ctx: { canvas: unknown }, width: number, height: number) {
    (ctx.canvas as { width: number; height: number }).width = width;
    (ctx.canvas as { height: number }).height = height;
  }
  destroy(ctx: { canvas: unknown }) {
    (ctx.canvas as { width: number }).width = 0;
    (ctx.canvas as { height: number }).height = 0;
  }
}

const data = new Uint8Array(await readFile('/home/z/my-project/public/sample-printified.pdf'));
const doc = await pdfjs.getDocument({ data, canvasFactory: new NodeCanvasFactory(), isEvalSupported: false }).promise;
console.log('pages:', doc.numPages);

mkdirSync('/tmp/example-check', { recursive: true });
for (const p of [1, 2, 13, 14]) {
  if (p > doc.numPages) continue;
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1.1 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvasFactory: new NodeCanvasFactory() } as never).promise;
  page.cleanup();
  await Bun.write(`/tmp/example-check/out-${p}.png`, canvas.toBuffer('image/png'));
  console.log(`rendered ${p}`);
}
