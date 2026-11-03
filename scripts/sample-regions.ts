/** Targeted region color sampling from the rendered pages. */
import { createCanvas, loadImage } from '@napi-rs/canvas';

const REGIONS: Record<string, { page: number; x: number; y: number; w: number; h: number }> = {
  'QUESTION-pill': { page: 1, x: 84, y: 668, w: 70, h: 24 },
  'option-square-A': { page: 1, x: 88, y: 774, w: 26, h: 26 },
  'option-square-B': { page: 1, x: 88, y: 816, w: 26, h: 26 },
  'watercolor-stain-right': { page: 1, x: 400, y: 430, w: 200, h: 150 },
  'watercolor-stain-below-topics': { page: 1, x: 100, y: 630, w: 120, h: 30 },
  'blue-pen-revised': { page: 1, x: 445, y: 342, w: 130, h: 40 },
  'blue-pen-formula': { page: 1, x: 500, y: 748, w: 100, h: 30 },
  'blue-box-outline-topicA': { page: 1, x: 142, y: 428, w: 180, h: 24 },
  'blue-underline-q1': { page: 1, x: 215, y: 700, w: 150, h: 14 },
  'pill-question2-p2': { page: 2, x: 84, y: 344, w: 70, h: 24 },
  'green-ink': { page: 1, x: 255, y: 815, w: 80, h: 70 },
  'orange-disc': { page: 2, x: 130, y: 400, w: 150, h: 60 },
};

for (const [name, reg] of Object.entries(REGIONS)) {
  const img = await loadImage(`/tmp/pdfpages/page-${reg.page}.png`);
  const canvas = createCanvas(reg.w, reg.h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
  const d = ctx.getImageData(0, 0, reg.w, reg.h).data;
  const hist = new Map<string, { n: number; rs: number; gs: number; bs: number }>();
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 10) * 10;
    const key = `lum${String(lum).padStart(4)}|${Math.round(r / 32)},${Math.round(g / 32)},${Math.round(b / 32)}`;
    const e = hist.get(key) ?? { n: 0, rs: 0, gs: 0, bs: 0 };
    e.n++; e.rs += r; e.gs += g; e.bs += b;
    hist.set(key, e);
    n++;
  }
  const top = [...hist.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  console.log(`\n## ${name} (page ${reg.page} @${reg.x},${reg.y} ${reg.w}x${reg.h})`);
  for (const [, v] of top) {
    const avg = `rgb(${Math.round(v.rs / v.n)},${Math.round(v.gs / v.n)},${Math.round(v.bs / v.n)})`;
    const lum = Math.round(0.299 * (v.rs / v.n) + 0.587 * (v.gs / v.n) + 0.114 * (v.bs / v.n));
    console.log(`  ${(100 * v.n / n).toFixed(1).padStart(5)}%  avg=${avg.padEnd(16)} lum=${lum}`);
  }
}
