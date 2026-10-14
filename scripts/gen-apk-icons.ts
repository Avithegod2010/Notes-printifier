/**
 * gen-apk-icons.ts — generates Android launcher icons from the PWA maskable
 * icon (full-bleed square → launchers apply their own masks cleanly).
 * Run: bun scripts/gen-apk-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const ROOT = path.resolve(import.meta.dir, '..');
const SRC = path.join(ROOT, 'public', 'icons', 'icon-maskable-512.png');
const OUT = path.join(ROOT, 'android', 'res');

const DENSITIES: Array<[string, number]> = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

async function main() {
  const img = await loadImage(SRC);
  for (const [dir, size] of DENSITIES) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    const outDir = path.join(OUT, dir);
    mkdirSync(outDir, { recursive: true });
    const buf = await canvas.encode('png');
    writeFileSync(path.join(outDir, 'ic_launcher.png'), buf);
    console.log(`✓ ${dir}/ic_launcher.png — ${size}x${size}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
