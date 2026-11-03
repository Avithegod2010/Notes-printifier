/** Render ORIGINAL sample-lecture.pdf pages for comparison. */
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

const data = new Uint8Array(await readFile('/home/z/my-project/public/sample-lecture.pdf'));
const doc = await pdfjs.getDocument({
  data,
  canvasFactory: new NodeCanvasFactory(),
  isEvalSupported: false,
  wasmUrl: '/home/z/my-project/node_modules/pdfjs-dist/wasm/',
}).promise;

mkdirSync('/tmp/example-check', { recursive: true });
for (const p of [37]) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1.3 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvasFactory: new NodeCanvasFactory() } as never).promise;
  page.cleanup();
  await Bun.write(`/tmp/example-check/src-${p}.png`, canvas.toBuffer('image/png'));
  console.log(`rendered src page ${p}`);
}
