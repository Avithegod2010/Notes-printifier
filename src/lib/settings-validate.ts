/**
 * settings-validate.ts — whitelist + clamp for user-supplied Enhance/Layout
 * settings at EVERY trust boundary: QR recipe links (?r=), shared preset
 * links (?p=), imported preset/backup files, the cloud preset API (write AND
 * read) and saved presets reloaded from localStorage.
 *
 * A crafted settings object must never reach the render pipeline: rows=9999
 * or customDpi=1e9 hangs/crashes composition, an unknown colorMode breaks
 * filter dispatch, a giant string field bloats the bundle. The rule is the
 * same as the Print Doctor's sanitizer (which this module now backs): unknown
 * keys are DROPPED, every value is type-checked and clamped to the exact
 * range the UI itself can produce. sanitize*Patch returns partials (missing
 * key = keep the default/existing value); sanitizeFilters/sanitizeLayout
 * spread the patch over the factory defaults for a fully-typed result.
 */

import {
  defaultFilters,
  type ColorMode,
  type FilterSettings,
  type LogoRegion,
} from './pdf/filters';
import {
  CALIB_MAX_MM,
  defaultLayout,
  DPI_MAX,
  DPI_MIN,
  MARGIN_MAX,
  MARGIN_MIN,
  type LayoutSettings,
  type MarginCalib,
  type PageSizeOpt,
  type QualityOpt,
} from './pdf/layout-settings';

const COLOR_MODES: readonly ColorMode[] = ['auto', 'original', 'invert', 'grayscale', 'bw'];
const PAGE_SIZES: readonly PageSizeOpt[] = ['a4', 'letter', 'a3', 'a5', 'legal', 'original', 'custom'];
const ORIENTATIONS = ['portrait', 'landscape'] as const;
const QUALITIES: readonly QualityOpt[] = ['low', 'medium', 'high'];
const OCR_PSMS = ['3', '6'] as const; // only PSMs the UI offers
const MAX_STRING = 80; // footer label / name stamp / doc metadata
const MAX_LOGO_REGIONS = 8;
const MAX_OCR_LANGS = 8;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampNum(v: unknown, min: number, max: number, round = true): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = round ? Math.round(v) : v;
  return Math.min(max, Math.max(min, n));
}

function clampString(v: unknown, max = MAX_STRING): string | null {
  if (typeof v !== 'string') return null;
  // strip control chars (newlines in a footer label would break the PDF text layer)
  return v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function clampCalib(v: unknown): MarginCalib | null {
  if (!isRecord(v)) return null;
  // calibration keeps sub-mm precision (a real border is 4.2mm, not 4)
  const e = (x: unknown) => clampNum(x, 0, CALIB_MAX_MM, false) ?? 0;
  return { t: e(v.t), r: e(v.r), b: e(v.b), l: e(v.l) };
}

function clampLogoRegions(v: unknown): LogoRegion[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LOGO_REGIONS) return null;
  const out: LogoRegion[] = [];
  for (const r of v) {
    if (!isRecord(r)) return null;
    const e = (x: unknown) => clampNum(x, 0, 1, false);
    const x = e(r.x);
    const y = e(r.y);
    const w = e(r.w);
    const h = e(r.h);
    if (x === null || y === null || w === null || h === null) return null;
    out.push({ x, y, w, h });
  }
  return out;
}

function clampOcrLangs(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_OCR_LANGS) return null;
  const out: string[] = [];
  for (const l of v) {
    if (typeof l !== 'string' || !/^[a-z]{3}$/.test(l)) return null;
    out.push(l);
  }
  return out;
}

/** Whitelist + clamp Enhance settings; unknown keys dropped, never trusted. */
export function sanitizeFiltersPatch(input: unknown): Partial<FilterSettings> {
  if (!isRecord(input)) return {};
  const out: Partial<FilterSettings> = {};

  if (typeof input.colorMode === 'string' && (COLOR_MODES as readonly string[]).includes(input.colorMode)) {
    out.colorMode = input.colorMode as ColorMode;
  }
  const inkSaver = clampNum(input.inkSaver, 0, 100);
  if (input.inkSaver !== undefined && inkSaver !== null) out.inkSaver = inkSaver;
  const penBoost = clampNum(input.penBoost, 0, 100);
  if (input.penBoost !== undefined && penBoost !== null) out.penBoost = penBoost;
  const headerTrim = clampNum(input.headerTrim, 0, 25);
  if (input.headerTrim !== undefined && headerTrim !== null) out.headerTrim = headerTrim;

  for (const key of ['cleanStains', 'boostBlueInk', 'trimMargins', 'searchable', 'deskew'] as const) {
    if (input[key] !== undefined && typeof input[key] === 'boolean') {
      out[key] = input[key] as boolean;
    }
  }

  const logoRegions = clampLogoRegions(input.logoRegions);
  if (input.logoRegions !== undefined && logoRegions) out.logoRegions = logoRegions;

  const ocrLangs = clampOcrLangs(input.ocrLangs);
  if (input.ocrLangs !== undefined && ocrLangs) out.ocrLangs = ocrLangs;

  if (
    input.ocrPsm !== undefined &&
    typeof input.ocrPsm === 'string' &&
    (OCR_PSMS as readonly string[]).includes(input.ocrPsm)
  ) {
    out.ocrPsm = input.ocrPsm;
  }

  return out;
}

/** Whitelist + clamp Layout settings; unknown keys dropped, never trusted. */
export function sanitizeLayoutPatch(input: unknown): Partial<LayoutSettings> {
  if (!isRecord(input)) return {};
  const out: Partial<LayoutSettings> = {};

  if (typeof input.pageSize === 'string' && (PAGE_SIZES as readonly string[]).includes(input.pageSize)) {
    out.pageSize = input.pageSize as PageSizeOpt;
  }
  if (
    typeof input.orientation === 'string' &&
    (ORIENTATIONS as readonly string[]).includes(input.orientation)
  ) {
    out.orientation = input.orientation as LayoutSettings['orientation'];
  }
  const rows = clampNum(input.rows, 1, 8);
  if (input.rows !== undefined && rows !== null) out.rows = rows;
  const cols = clampNum(input.cols, 1, 4);
  if (input.cols !== undefined && cols !== null) out.cols = cols;
  const quality = input.quality;
  if (typeof quality === 'string' && (QUALITIES as readonly string[]).includes(quality)) {
    out.quality = quality as QualityOpt;
  }

  for (const key of [
    'separators',
    'pageNumbers',
    'booklet',
    'duplexPad',
    'slideNumbers',
    'noteLines',
    'coverSheet',
    'recipeQr',
  ] as const) {
    if (input[key] !== undefined && typeof input[key] === 'boolean') {
      out[key] = input[key] as boolean;
    }
  }

  if (input.customDpi === null) out.customDpi = null;
  else {
    const dpi = clampNum(input.customDpi, DPI_MIN, DPI_MAX);
    if (input.customDpi !== undefined && dpi !== null) out.customDpi = dpi;
  }

  if (input.sizeTargetMB === null) out.sizeTargetMB = null;
  else {
    const mb = clampNum(input.sizeTargetMB, 0, 200);
    if (input.sizeTargetMB !== undefined && mb !== null) out.sizeTargetMB = mb;
  }

  const margin = clampNum(input.sheetMargin, MARGIN_MIN, MARGIN_MAX);
  if (input.sheetMargin !== undefined && margin !== null) out.sheetMargin = margin;

  if (input.calib !== undefined) {
    const calib = clampCalib(input.calib);
    if (calib) out.calib = calib;
  }

  if (input.customPageW === null) out.customPageW = null;
  else {
    const w = clampNum(input.customPageW, 10, 1200);
    if (input.customPageW !== undefined && w !== null) out.customPageW = w;
  }
  if (input.customPageH === null) out.customPageH = null;
  else {
    const h = clampNum(input.customPageH, 10, 1200);
    if (input.customPageH !== undefined && h !== null) out.customPageH = h;
  }

  const footer = clampString(input.footerLabel);
  if (input.footerLabel !== undefined && footer !== null) out.footerLabel = footer;
  const stamp = clampString(input.nameStamp);
  if (input.nameStamp !== undefined && stamp !== null) out.nameStamp = stamp;
  const title = clampString(input.docTitle);
  if (input.docTitle !== undefined && title !== null) out.docTitle = title;
  const author = clampString(input.docAuthor);
  if (input.docAuthor !== undefined && author !== null) out.docAuthor = author;

  return out;
}

/** Full Enhance settings = factory defaults + a validated patch. */
export function sanitizeFilters(input: unknown): FilterSettings {
  return { ...defaultFilters, ...sanitizeFiltersPatch(input) };
}

/** Full Layout settings = factory defaults + a validated patch. */
export function sanitizeLayout(input: unknown): LayoutSettings {
  return { ...defaultLayout, ...sanitizeLayoutPatch(input) };
}
