/**
 * gen-pwa-icons.ts — one-off generator for PWA icon PNGs (Task 7-d).
 *
 * Run: bun scripts/gen-pwa-icons.ts
 *
 * Design: rounded-square (maskable: full-bleed square) with a diagonal
 * violet-600 → fuchsia-600 gradient and a white printer glyph
 * (input sheet on top, printer body with LED, output sheet/tray below).
 *
 * Per spec we first ATTEMPT to rasterize public/logo.svg via @napi-rs/canvas.
 * logo.svg turns out to be the dark "Z" platform mark (not a printer glyph),
 * so the final icons use the manually-drawn printer glyph described in the task.
 */
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

const VIOLET = '#7c3aed'; // violet-600
const FUCHSIA = '#c026d3'; // fuchsia-600
const INK = 'rgba(124, 58, 237, 0.5)'; // "text" lines on the paper sheets

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGradientBackground(
  ctx: SKRSContext2D,
  size: number,
  radius: number,
) {
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, VIOLET);
  g.addColorStop(1, FUCHSIA);
  ctx.fillStyle = g;
  if (radius > 0) {
    roundRect(ctx, 0, 0, size, size, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }
}

/**
 * White printer glyph drawn inside an S×S box whose top-left corner is (x0, y0).
 * All coordinates are in a 100×100 design space, uniformly scaled by S/100.
 * Layout (y ranges): input sheet 8–34 (partially behind body), body 30–62,
 * output sheet 56–92 (sticks out below body). Centered on (50, 50).
 */
function drawPrinterGlyph(ctx: SKRSContext2D, x0: number, y0: number, S: number) {
  const f = S / 100;
  const X = (v: number) => x0 + v * f;
  const Y = (v: number) => y0 + v * f;
  const L = (v: number) => v * f;

  ctx.save();
  ctx.fillStyle = '#ffffff';

  // Output sheet — drawn first so the body overlaps its top edge (paper "coming out").
  roundRect(ctx, X(26), Y(56), L(48), L(36), L(4));
  ctx.fill();

  // Input sheet — drawn behind the body (paper "feeding in").
  roundRect(ctx, X(28), Y(8), L(44), L(26), L(4));
  ctx.fill();

  // Printer body.
  roundRect(ctx, X(12), Y(30), L(76), L(32), L(9));
  ctx.fill();

  // Status LED on the body.
  ctx.fillStyle = FUCHSIA;
  ctx.beginPath();
  ctx.arc(X(77), Y(46), L(3.2), 0, Math.PI * 2);
  ctx.fill();

  // "Text" lines on the visible parts of both sheets.
  ctx.strokeStyle = INK;
  ctx.lineWidth = L(3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(X(36), Y(15));
  ctx.lineTo(X(64), Y(15));
  ctx.moveTo(X(36), Y(21));
  ctx.lineTo(X(56), Y(21));
  ctx.moveTo(X(34), Y(70));
  ctx.lineTo(X(66), Y(70));
  ctx.moveTo(X(34), Y(77));
  ctx.lineTo(X(58), Y(77));
  ctx.moveTo(X(34), Y(84));
  ctx.lineTo(X(62), Y(84));
  ctx.stroke();

  ctx.restore();
}

async function makeIcon(
  file: string,
  size: number,
  opts: { radius: number; padding: number },
) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawGradientBackground(ctx, size, opts.radius);
  const glyphSize = size - 2 * opts.padding;
  drawPrinterGlyph(ctx, opts.padding, opts.padding, glyphSize);
  const buf = await canvas.encode('png');
  writeFileSync(path.join(OUT_DIR, file), buf);
  console.log(`✓ ${file} — ${size}x${size}, ${buf.length} bytes`);
}

/** Spec step 1: try rasterizing public/logo.svg; report the outcome. */
async function tryLogoSvg(): Promise<boolean> {
  try {
    const svgPath = path.join(ROOT, 'public', 'logo.svg');
    const img = await loadImage(readFileSync(svgPath));
    const probe = createCanvas(64, 64);
    const pctx = probe.getContext('2d');
    pctx.drawImage(img, 0, 0, 64, 64);
    const { data } = pctx.getImageData(0, 0, 64, 64);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque++;
    console.log(
      `logo.svg rasterization: OK (${opaque}/4096 opaque px). ` +
        `Not used for the final icons: logo.svg is the dark "Z" platform mark, ` +
        `not the white printer glyph this task specifies.`,
    );
    return true;
  } catch (err) {
    console.log(
      'logo.svg rasterization failed:',
      err instanceof Error ? err.message : String(err),
      '→ falling back to the manual printer glyph.',
    );
    return false;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await tryLogoSvg();

  // Standard "any" icons: rounded square, 12.5% padding.
  await makeIcon('icon-512.png', 512, {
    radius: Math.round(512 * 0.225),
    padding: 64,
  });
  await makeIcon('icon-192.png', 192, {
    radius: Math.round(192 * 0.225),
    padding: 24,
  });

  // Maskable: full-bleed background (radius 0), glyph inside the inner 66% safe zone.
  const maskGlyph = Math.round(512 * 0.66);
  await makeIcon('icon-maskable-512.png', 512, {
    radius: 0,
    padding: (512 - maskGlyph) / 2,
  });

  // Apple touch icon: 180x180, opaque, slight padding (iOS applies its own mask).
  await makeIcon('apple-touch-icon.png', 180, { radius: 0, padding: 16 });

  // Verify every PNG exists and is > 1KB.
  for (const f of [
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
  ]) {
    const st = statSync(path.join(OUT_DIR, f));
    if (st.size <= 1024) throw new Error(`${f} is only ${st.size} bytes`);
  }
  console.log('All 4 PWA icons generated and verified (>1KB).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
