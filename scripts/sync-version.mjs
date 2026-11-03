/**
 * sync-version.mjs — generate every version number from ONE source:
 * package.json → "version".
 *
 * Regenerates:
 *   - src/lib/version.ts        (APP_VERSION)
 *   - public/version.json       ("version" field; notes are left untouched)
 *   - android/AndroidManifest.xml (versionName; versionCode = major*10000
 *     + minor*100 + patch — monotonic: 2.4.0 → 20400)
 *
 * Run manually after a bump:  node scripts/sync-version.mjs
 * (CI instead runs scripts/check-version.mjs to FAIL when they drift.)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json version "${version}" is not semver X.Y.Z`);
  process.exit(1);
}
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
const today = new Date().toISOString().slice(0, 10);

// src/lib/version.ts
const vtPath = join(ROOT, 'src/lib/version.ts');
const vt = readFileSync(vtPath, 'utf8');
writeFileSync(
  vtPath,
  vt.replace(/export const APP_VERSION = '[^']*';/, `export const APP_VERSION = '${version}';`),
);

// public/version.json — only the version + updated fields; notes stay.
const vjPath = join(ROOT, 'public/version.json');
const manifest = JSON.parse(readFileSync(vjPath, 'utf8'));
manifest.version = version;
manifest.updated = today;
writeFileSync(vjPath, JSON.stringify(manifest, null, 2) + '\n');

// android/AndroidManifest.xml
const amPath = join(ROOT, 'android/AndroidManifest.xml');
const am = readFileSync(amPath, 'utf8');
writeFileSync(
  amPath,
  am
    .replace(/android:versionCode="\d+"/, `android:versionCode="${versionCode}"`)
    .replace(/android:versionName="[^"]*"/, `android:versionName="${version}"`),
);

console.log(`synced → ${version} (android versionCode ${versionCode}, updated ${today})`);
