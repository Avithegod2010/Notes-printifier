/**
 * recipe-link.ts — self-contained "recipe" links for the result-page QR.
 *
 * A recipe is the full Enhance + Layout settings snapshot, diffed against the
 * built-in defaults so only the interesting deltas are stored. The diff is
 * serialized as JSON → base64url and carried in the `?r=` query param, which
 * keeps the whole flow working on STATIC hosting (GitHub Pages / APK) — no
 * server, no preset ID lookup, nothing leaves the device.
 *
 * Scanning the QR opens the site; the app decodes ?r=, applies the settings
 * and strips the param (see PrintifierApp).
 */

import { defaultFilters, type FilterSettings } from './pdf/filters';
import { defaultLayout, type LayoutSettings } from './pdf/layout-settings';

const MAX_ENCODE_LEN = 1400; // QR-safe ceiling (version ~25 at ECC-M)

function toB64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(code: string): string | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** JSON-stable comparison — treats undefined/null/'' as equal-ish defaults. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Diff settings against defaults → compact JSON → base64url.
 * Returns null when the resulting code would be uselessly long.
 */
export function encodeRecipe(
  filters: FilterSettings,
  layout: LayoutSettings,
): string | null {
  const fDiff: Record<string, unknown> = {};
  const fDefaults = defaultFilters as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(filters)) {
    if (!sameValue(v, fDefaults[k])) {
      fDiff[k] = v;
    }
  }
  const lDiff: Record<string, unknown> = {};
  const lDefaults = defaultLayout as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(layout)) {
    if (!sameValue(v, lDefaults[k])) {
      lDiff[k] = v;
    }
  }
  const json = JSON.stringify({ v: 1, f: fDiff, l: lDiff });
  const code = toB64Url(json);
  return code.length <= MAX_ENCODE_LEN ? code : null;
}

export interface DecodedRecipe {
  filters: Partial<FilterSettings>;
  layout: Partial<LayoutSettings>;
}

/** Parse a recipe code back into settings patches (null = invalid). */
export function decodeRecipe(code: string): DecodedRecipe | null {
  const json = fromB64Url(code);
  if (!json) return null;
  try {
    const data = JSON.parse(json) as {
      v?: number;
      f?: Record<string, unknown>;
      l?: Record<string, unknown>;
    };
    if (data.v !== 1) return null;
    if (typeof data.f !== 'object' || data.f === null) return null;
    if (typeof data.l !== 'object' || data.l === null) return null;
    // Keep only known keys — unknown fields are dropped (forward compat).
    const f: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.f)) {
      if (k in defaultFilters) f[k] = v;
    }
    const l: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.l)) {
      if (k in defaultLayout) l[k] = v;
    }
    return { filters: f, layout: l };
  } catch {
    return null;
  }
}

/** Build the full URL a QR should encode (origin + base path + ?r=code). */
export function recipeUrl(code: string): string {
  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${BASE}/?r=${code}`;
}
