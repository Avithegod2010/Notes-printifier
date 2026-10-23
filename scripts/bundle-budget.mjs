#!/usr/bin/env node
/**
 * bundle-budget.mjs — JS bundle growth gate for CI.
 *
 * Sums every shipped .js/.mjs file in the static export (".next-static") and
 * compares the total against scripts/bundle-baseline.json.
 *
 *   growth > 10%  → FAIL (exit 1) with instructions to consciously re-baseline
 *   growth 0–10%  → pass, with a friendly heads-up
 *   negative      → pass, and print the savings (nice!)
 *
 * Usage:
 *   node scripts/bundle-budget.mjs            # check against the baseline
 *   node scripts/bundle-budget.mjs --update   # accept current sizes as baseline
 *   BUDGET_PCT=15 node scripts/budget.mjs     # custom threshold
 *
 * The baseline is committed, so a bundle blow-up fails CI BEFORE it reaches
 * the deploy workflow — not after students download 3 MB of JS on 2G.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const EXPORT_DIR = join(ROOT, '.next-static');
const BASELINE_FILE = join(ROOT, 'scripts', 'bundle-baseline.json');
const BUDGET_PCT = Number(process.env.BUDGET_PCT ?? 10);
const UPDATE = process.argv.includes('--update');

function walkJsFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJsFiles(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function totalBytes(files) {
  return files.reduce((sum, f) => sum + statSync(f).size, 0);
}

const fmt = (b) => `${(b / 1024).toFixed(1)} KB`;

const files = walkJsFiles(EXPORT_DIR);
if (files.length === 0) {
  console.error(
    `✗ bundle-budget: no .js files found under ${EXPORT_DIR}.\n` +
      '  Run "bun run build:static" first (CI does this automatically).',
  );
  process.exit(1);
}
const current = totalBytes(files);

if (UPDATE) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        totalJsBytes: current,
        files: files.length,
        generatedAt: new Date().toISOString(),
        note: 'Regenerate with: bun run build:static && bun run budget:update',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`✓ baseline updated: ${fmt(current)} across ${files.length} JS files`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  // bootstrap: first run on a fresh checkout writes the baseline instead of failing
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        totalJsBytes: current,
        files: files.length,
        generatedAt: new Date().toISOString(),
        note: 'Regenerate with: bun run build:static && bun run budget:update',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`✓ no baseline found — wrote one at ${fmt(current)} (${files.length} files)`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const base = Number(baseline.totalJsBytes);
if (!Number.isFinite(base) || base <= 0) {
  console.error('✗ bundle-budget: baseline file is corrupt — run `bun run budget:update`.');
  process.exit(1);
}

const growthPct = ((current - base) / base) * 100;
console.log(`bundle: ${fmt(current)} vs baseline ${fmt(base)} (${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%)`);

if (growthPct > BUDGET_PCT) {
  console.error(
    `\n✗ JS bundle grew ${growthPct.toFixed(1)}% — over the ${BUDGET_PCT}% budget.\n` +
      '  If the growth is intentional, re-baseline deliberately:\n' +
      '    bun run build:static && bun run budget:update\n' +
      '  and commit scripts/bundle-baseline.json with a note in the PR.',
  );
  process.exit(1);
}
if (growthPct > 0) {
  console.log(`△ within budget, but keep an eye on it (limit ${BUDGET_PCT}%).`);
} else {
  console.log(`✓ bundle is ${Math.abs(growthPct).toFixed(1)}% smaller than baseline. 🎉`);
}
