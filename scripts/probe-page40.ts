/** Probe: does sample page 40 render blank at certain scales? */
import { createCanvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

class F {
  create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset(ctx, w, h) { ctx.canvas.width = w; ctx.canvas.height = h; }
  destroy(ctx) { ctx.canvas.width = 0; ctx.canvas.height = 0; }
}

const data = new Uint8Array(await readFile('/home/z/my-project/public/sample-lecture.pdf'));
const doc = await pdfjs.getDocument({
  data, canvasFactory: new F(), isEvalSupported: false,
  wasmUrl: '/home/z/my-project/node_modules/pdfjs-dist/wasm/',
}).promise;

for (const target of [220, 300, 400, 620, 900, 1165]) {
  const page = await doc.getPage(40);
  const base = page.getViewport({ scale: 1 });
  const scale = target / base.width;
  const vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  try {
    await page.render({ canvasContext: ctx, viewport: vp, canvasFactory: new F() }).promise;
  } catch (e) { console.log(target, 'RENDER ERROR', e.message); continue; }
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let min = 255, max = 0, dark = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 13) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (v < min) min = v; if (v > max) max = v;
    if (v < 205) dark++;
    n++;
  }
  console.log(`target=${target} scale=${scale.toFixed(3)} size=${c.width}x${c.height} min=${min.toFixed(0)} max=${max.toFixed(0)} darkFrac=${(dark / n).toFixed(4)}`);
  page.cleanup();
}
