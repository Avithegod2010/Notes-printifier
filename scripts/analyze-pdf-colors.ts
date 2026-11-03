/**
 * Color analysis of the uploaded lecture PDF using pdfjs-dist + @napi-rs/canvas.
 * Histograms bluish pixels by luminance bands so we can calibrate "stain
 * removal" thresholds that kill watercolor stains + cyan QUESTION pills
 * while sparing blue/green handwriting.
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync } from 'node:fs';

const PDF = '/home/z/my-project/upload/Unknown.pdf';
const PAGES = [1, 2, 3, 4, 8, 10, 13, 14];
const DUMP_PNGS = true;

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

const data = new Uint8Array(await (await import('node:fs/promises')).readFile(PDF));
const doc = await pdfjs.getDocument({
  data,
  canvasFactory: new NodeCanvasFactory(),
  isEvalSupported: false,
  useSystemFonts: true,
}).promise;

console.log('pages:', doc.numPages);

interface Cluster { n: number; rs: number; gs: number; bs: number; samples: string[] }

function classify(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (max - min < 12) return lum > 235 ? 'near-white' : lum > 180 ? 'light-gray' : 'gray/dark';
  if (r >= g && r >= b) return r - Math.min(g, b) > 60 ? 'orange/red' : 'warm';
  if (g >= r && g >= b) return 'green';
  const cyanish = g >= r + 6; // g above r => cyan/sky side, else violet side
  if (lum >= 200) return cyanish ? 'B:light-cyan(lum>=200)' : 'B:light-violet(lum>=200)';
  if (lum >= 165) return cyanish ? 'B:light-cyan(165-199)' : 'B:light-violet(165-199)';
  if (lum >= 145) return cyanish ? 'B:light-cyan(145-164)' : 'B:light-violet(145-164)';
  if (lum >= 110) return cyanish ? 'B:mid-cyan(110-144)' : 'B:mid-violet(110-144)';
  return cyanish ? 'B:dark(<110)' : 'B:dark-violet(<110)';
}

if (DUMP_PNGS) mkdirSync('/tmp/pdfpages', { recursive: true });

for (const p of PAGES) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1.2 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport: vp, canvasFactory: new NodeCanvasFactory() } as never).promise;
  page.cleanup();

  if (DUMP_PNGS) {
    await Bun.write(`/tmp/pdfpages/page-${p}.png`, canvas.toBuffer('image/png'));
  }

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const clusters = new Map<string, Cluster>();
  let white = 0;
  const total = canvas.width * canvas.height;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min >= 235) { white++; continue; }
    const c = classify(r, g, b);
    let cl = clusters.get(c);
    if (!cl) { cl = { n: 0, rs: 0, gs: 0, bs: 0, samples: [] }; clusters.set(c, cl); }
    cl.n++; cl.rs += r; cl.gs += g; cl.bs += b;
    if (cl.samples.length < 3 && max - min > 25 && ((i / 4) % 11 === 0)) {
      cl.samples.push(`rgb(${r},${g},${b})`);
    }
  }
  console.log(`\n===== PAGE ${p} (${canvas.width}x${canvas.height}) =====`);
  console.log(`pure/near-white: ${(100 * white / total).toFixed(1)}%`);
  const sorted = [...clusters.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [k, v] of sorted) {
    const avg = `rgb(${Math.round(v.rs / v.n)},${Math.round(v.gs / v.n)},${Math.round(v.bs / v.n)})`;
    const pct = (100 * v.n / (total - white)).toFixed(2);
    console.log(`${k.padEnd(28)} ${pct.padStart(6)}%  avg=${avg.padEnd(16)} e.g. ${v.samples.slice(0, 3).join(' ')}`);
  }
}
