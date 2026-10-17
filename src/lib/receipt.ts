/**
 * receipt.ts — a shareable PNG "ink-savings receipt".
 *
 * After a conversion, students get a card they can post in class groups:
 * how many slides went in, how many sheets came out, how much ink (and
 * rupees) were saved. Drawn 100% locally on a canvas — no uploads, no
 * server round-trip, works offline.
 */

interface ReceiptData {
  inputPages: number;
  outputPages: number;
  inkSavedPct: number;
  paperSavedPct: number;
  /** Money saved (rupees, already formatted, e.g. "₹27"). */
  rupees: string;
  /** Final PDF size, formatted (e.g. "3.4 MB"). */
  fileSize: string;
  /** F7 streak/milestone chip, e.g. "3-week streak 🔥 · 120 sheets". Optional. */
  badgeText?: string;
}

interface ReceiptLabels {
  title: string;
  subtitle: string;
  inkSaved: string;
  pagesIn: string;
  paperSaved: string;
  moneySaved: string;
  fileSize: string;
  footnote: string;
}

const W = 1080;
const H = 1350;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  weight = '700',
): number {
  let size = startPx;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > startPx * 0.55) {
    size -= 2;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  }
  return size;
}

/** Draw the receipt card. Returns the canvas — caller encodes/shares it. */
export function buildReceiptCanvas(data: ReceiptData, labels: ReceiptLabels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  // backdrop: violet → fuchsia gradient with a faint grain-free vignette
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#6d28d9');
  grad.addColorStop(0.55, '#7c3aed');
  grad.addColorStop(1, '#c026d3');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // white card
  const cx = 60;
  const cy = 88;
  const cw = W - cx * 2;
  const ch = H - cy * 2 - 120;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx, cy, cw, ch, 36);
  ctx.fill();

  // header band
  ctx.fillStyle = '#111111';
  const titleSize = fitText(ctx, labels.title, cw - 120, 54);
  ctx.font = `800 ${titleSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(labels.title, W / 2, cy + 96);
  ctx.fillStyle = '#7c3aed';
  ctx.font = `600 26px system-ui, sans-serif`;
  ctx.fillText(labels.subtitle, W / 2, cy + 138);
  ctx.textAlign = 'left';

  // divider
  ctx.strokeStyle = '#ede9fe';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + 48, cy + 176);
  ctx.lineTo(cx + cw - 48, cy + 176);
  ctx.stroke();

  // hero stat: ink saved
  const heroY = cy + 320;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#059669';
  const heroSize = fitText(ctx, `${data.inkSavedPct}%`, cw - 160, 190, '800');
  ctx.font = `800 ${heroSize}px system-ui, sans-serif`;
  ctx.fillText(`${data.inkSavedPct}%`, W / 2, heroY);
  ctx.fillStyle = '#374151';
  ctx.font = `600 30px system-ui, sans-serif`;
  ctx.fillText(labels.inkSaved, W / 2, heroY + 48);
  ctx.textAlign = 'left';

  // 2×2 stat grid
  const cells: Array<{ v: string; l: string; tone: string }> = [
    {
      v: `${data.inputPages} → ${data.outputPages}`,
      l: labels.pagesIn,
      tone: '#111111',
    },
    { v: `${data.paperSavedPct}%`, l: labels.paperSaved, tone: '#111111' },
    { v: data.rupees, l: labels.moneySaved, tone: '#059669' },
    { v: data.fileSize, l: labels.fileSize, tone: '#111111' },
  ];
  const gx = cx + 44;
  const gy = heroY + 108;
  const gw = (cw - 88 - 28) / 2;
  const gh = 150;
  cells.forEach((cell, i) => {
    const x = gx + (i % 2) * (gw + 28);
    const y = gy + Math.floor(i / 2) * (gh + 22);
    ctx.fillStyle = '#faf7ff';
    roundRect(ctx, x, y, gw, gh, 22);
    ctx.fill();
    ctx.strokeStyle = '#ede9fe';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, gw, gh, 22);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = cell.tone;
    const vSize = fitText(ctx, cell.v, gw - 36, 46);
    ctx.font = `800 ${vSize}px system-ui, sans-serif`;
    ctx.fillText(cell.v, x + gw / 2, y + gh / 2 - 4);
    ctx.fillStyle = '#6b7280';
    ctx.font = `600 22px system-ui, sans-serif`;
    ctx.fillText(cell.l, x + gw / 2, y + gh / 2 + 34);
    ctx.textAlign = 'left';
  });

  // F7 streak / milestone chip (optional) — a violet pill between the grid
  // and the footnote.
  if (data.badgeText) {
    const text = data.badgeText.slice(0, 48);
    ctx.textAlign = 'center';
    ctx.font = `700 30px system-ui, sans-serif`;
    const tw = Math.min(cw - 80, ctx.measureText(text).width + 96);
    const by = gy + 2 * (gh + 22) + 44;
    const bx = (W - tw) / 2;
    ctx.fillStyle = '#f5f3ff';
    roundRect(ctx, bx, by, tw, 64, 32);
    ctx.fill();
    ctx.strokeStyle = '#ddd6fe';
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, tw, 64, 32);
    ctx.stroke();
    ctx.fillStyle = '#6d28d9';
    ctx.font = `700 30px system-ui, sans-serif`;
    ctx.fillText(text, W / 2, by + 42);
    ctx.textAlign = 'left';
  }

  // footnote inside the card
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9ca3af';
  ctx.font = `500 24px system-ui, sans-serif`;
  ctx.fillText(labels.footnote, W / 2, cy + ch - 44);
  ctx.textAlign = 'left';

  // footer under the card: date + repo
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'center';
  ctx.font = `600 26px system-ui, sans-serif`;
  const date = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  ctx.fillText(date, W / 2, H - 46);
  ctx.textAlign = 'left';

  return canvas;
}

/** Encode the receipt to a PNG Blob (for download or Web Share). */
export async function receiptCanvasToBlob(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}
