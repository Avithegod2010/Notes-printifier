/** Check diagram elements (must survive) vs stains (must die). */
import { createCanvas, loadImage } from '@napi-rs/canvas';

const REGIONS: Record<string, { page: number; x: number; y: number; w: number; h: number }> = {
  'Q12-rod-1': { page: 8, x: 200, y: 784, w: 110, h: 8 },
  'Q12-rod-2': { page: 8, x: 190, y: 800, w: 110, h: 8 },
  'Q12-rod-3': { page: 8, x: 183, y: 818, w: 110, h: 8 },
  'Q10-vertical-rod': { page: 8, x: 178, y: 130, w: 8, h: 130 },
  'Q10-horizontal-rod': { page: 8, x: 130, y: 166, w: 90, h: 8 },
  'Q11-top-bar': { page: 8, x: 200, y: 384, w: 110, h: 8 },
  'Q11-diagonal-rod': { page: 8, x: 180, y: 470, w: 40, h: 60 },
  'stain-near-Q12': { page: 8, x: 200, y: 690, w: 80, h: 60 },
  'stain-left-Q12': { page: 8, x: 100, y: 700, w: 60, h: 60 },
  'Q13-hatch-disc': { page: 9, x: 150, y: 120, w: 100, h: 80 },
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
    const key = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}|L${lum}`;
    const e = hist.get(key) ?? { n: 0, rs: 0, gs: 0, bs: 0 };
    e.n++; e.rs += r; e.gs += g; e.bs += b;
    hist.set(key, e);
    n++;
  }
  const top = [...hist.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  console.log(`\n## ${name}`);
  for (const [, v] of top) {
    const avg = `rgb(${Math.round(v.rs / v.n)},${Math.round(v.gs / v.n)},${Math.round(v.bs / v.n)})`;
    const lum = Math.round(0.299 * (v.rs / v.n) + 0.587 * (v.gs / v.n) + 0.114 * (v.bs / v.n));
    console.log(`  ${(100 * v.n / n).toFixed(1).padStart(5)}%  avg=${avg.padEnd(16)} lum=${lum}`);
  }
}
