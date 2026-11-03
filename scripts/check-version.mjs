/**
 * check-version.mjs — CI gate: every version number must match the single
 * source of truth (package.json → "version"). Fails (exit 1) on drift:
 *   - src/lib/version.ts   APP_VERSION
 *   - public/version.json  version
 *   - android/AndroidManifest.xml versionName (+ versionCode formula
 *     major*10000 + minor*100 + patch, set by scripts/sync-version.mjs)
 *
 * Repairs are always:  node scripts/sync-version.mjs && git commit
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const want = pkg.version;
const [major, minor, patch] = want.split('.').map(Number);
const wantCode = major * 10000 + minor * 100 + patch;

const problems = [];

// src/lib/version.ts
const vt = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const app = vt.match(/export const APP_VERSION = '([^']*)'/)?.[1];
if (app !== want) problems.push(`src/lib/version.ts APP_VERSION = ${app} (want ${want})`);

// public/version.json
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/version.json'), 'utf8'));
if (manifest.version !== want) {
  problems.push(`public/version.json version = ${manifest.version} (want ${want})`);
}

// android/AndroidManifest.xml
const am = readFileSync(join(ROOT, 'android/AndroidManifest.xml'), 'utf8');
const vName = am.match(/android:versionName="([^"]*)"/)?.[1];
const vCode = Number(am.match(/android:versionCode="(\d+)"/)?.[1]);
if (vName !== want) problems.push(`AndroidManifest versionName = ${vName} (want ${want})`);
if (vCode !== wantCode) {
  problems.push(`AndroidManifest versionCode = ${vCode} (want ${wantCode})`);
}

// android/build-apk.sh — beta defaults must derive from the manifest/pkg
// (hardcoded versions there drift silently).
const sh = readFileSync(join(ROOT, 'android/build-apk.sh'), 'utf8');
if (/BETA_VERSION_NAME:-\d+\.\d+/.test(sh)) {
  problems.push('android/build-apk.sh still hardcodes a beta version default (must derive from package.json)');
}

if (problems.length > 0) {
  console.error('Version drift detected — run: node scripts/sync-version.mjs');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`versions consistent: ${want} (android versionCode ${wantCode})`);
