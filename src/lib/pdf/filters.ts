/**
 * Pixel-level print optimization filters, applied on a canvas via ImageData.
 * These are the core "ink savers":
 *  - auto (smart per-page invert): every page is measured — dark slides are
 *    inverted, light pages are left alone. The single best default for mixed
 *    decks; per-page decisions replace the old all-or-nothing invert.
 *  - invert: dark slides (Physics Wallah / teacher-style decks) become white
 *    pages with dark content — the single biggest ink + readability win.
 *  - grayscale / bw: remove color entirely (bw thresholds to pure black/white).
 *  - inkSaver: a levels adjustment that pushes near-white pixels to pure
 *    white (and near-black to black), so printers lay down almost no ink
 *    on backgrounds.
 *  - penBoost: darkens handwriting strokes (mid-tones) while keeping paper
 *    white — makes pencil/light-pen notes survive printing.
 *  - cleanStains: kills light cyan/blue "watercolor" washes and bright cyan
 *    fills (QUESTION-label pills, A/B/C/D option squares, slide decorations)
 *    while preserving handwriting and diagrams. Thresholds were calibrated
 *    against real lecture PDFs:
 *      cyan pill / option fills .... rgb(68,254,254) lum ≈ 199-213  → killed
 *      watercolor washes ........... lum ≈ 202-253, low saturation   → killed
 *      blue pen cores .............. lum ≈ 100-120                   → kept
 *      blue pen (anti-aliased edge)  lum ≈ 160-180                   → kept
 *      diagram rods/lines .......... rgb(0,157,242) lum ≈ 120        → kept
 *      green ink cores ............. rgb(75,236,152) lum ≈ 190, high
 *                                    saturation (diff 161 > 75)      → kept
 *
 *    cleanStains ALSO applies in invert mode (calibrated there too): dark
 *    brown slide backgrounds invert to light BLUE-tinted whites (the cyan
 *    "wash" cast users see), and red option-key fills invert to bright cyan.
 *    Post-invert rules (pixels are already inverted when tested):
 *      brown bg inverse ............ rgb(195..240, 210..245, 217..250) → killed
 *      red key/pill inverse ........ rgb(65,225,215) lum ≈ 176         → killed
 *      yellow text inverse (blue) .. rgb(0,55,255) lum ≈ 61            → kept
 *      orange art inverse (blue) ... rgb(15,105,195) lum ≈ 88          → kept
 *      green ink inverse (magenta) . rgb(180,19,103) g≪r               → kept
 *
 * Canvas note: every function accepts BOTH HTMLCanvasElement (main thread)
 * and OffscreenCanvas (inside the processing Web Worker), so the exact same
 * pipeline runs in either context.
 */

export type ColorMode = 'auto' | 'original' | 'invert' | 'grayscale' | 'bw';

/** Canvas types that work both on the main thread and inside a Worker. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyCtx =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface FilterSettings {
  colorMode: ColorMode;
  /** 0–100 strength of the white-boost / ink saver levels adjustment. */
  inkSaver: number;
  /** Remove light cyan/blue background washes + cyan label fills. */
  cleanStains: boolean;
  /** Auto-crop near-white margins so content fills each grid cell. */
  trimMargins: boolean;
  /** 0–100 — darkens handwriting strokes, keeps paper white. */
  penBoost: number;
  /** Add an invisible OCR text layer so the output PDF is searchable. */
  searchable: boolean;
}

export const defaultFilters: FilterSettings = {
  colorMode: 'invert',
  inkSaver: 45,
  cleanStains: true,
  trimMargins: false,
  penBoost: 0,
  searchable: false,
};

/** Bright-cyan cut (QUESTION pills, option keys, cyan wash cores). */
const CYAN_LUM_CUT = 182;
/** Light-tint cut (watercolor stains, paper tints, soft shadows). */
const TINT_LUM_CUT = 200;
/**
 * Post-invert cyan cut — must sit ABOVE the inverse of red TEXT cores
 * (lum ≈ 162) so red handwriting survives, but BELOW the inverse of red
 * key/pill FILLS (lum ≈ 176-215) so those go white.
 */
const INVERT_CYAN_LUM_CUT = 170;
/** Mean luminance below which a page counts as "dark" in auto mode. */
export const AUTO_INVERT_THRESHOLD = 110;

/** Create a canvas of the same kind as the given one. */
export function createLikeCanvas(canvas: AnyCanvas, w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Fraction of sampled pixels considered "inked" (darker than threshold). */
export function inkCoverage(data: Uint8ClampedArray): number {
  let dark = 0;
  let total = 0;
  // Sample every 7th pixel — plenty for an estimate, ~7x cheaper.
  for (let i = 0; i < data.length; i += 4 * 7) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (y < 205) dark++;
    total++;
  }
  return total === 0 ? 0 : dark / total;
}

/**
 * Mean luminance (0–255) of a canvas — the "is this page dark?" signal used
 * by smart per-page invert. Samples sparsely; plenty accurate for a decision.
 */
export function meanLuminance(canvas: AnyCanvas): number {
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  if (!ctx) return 255;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 13) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  return n === 0 ? 255 : sum / n;
}

/**
 * Resolve colorMode 'auto' into a concrete mode for this page.
 * Dark page → invert; light page → original (stain cleanup still applies).
 * Every other mode passes straight through.
 */
export function resolveColorMode(canvas: AnyCanvas, mode: ColorMode): ColorMode {
  if (mode !== 'auto') return mode;
  return meanLuminance(canvas) < AUTO_INVERT_THRESHOLD ? 'invert' : 'original';
}

function levels(v: number, blackCut: number, whiteCut: number): number {
  if (v <= blackCut) return 0;
  if (v >= whiteCut) return 255;
  return ((v - blackCut) * 255) / (whiteCut - blackCut);
}

/**
 * True for pixels that are part of a cyan/blue background wash or a bright
 * cyan fill: they carry no information but cost ink. Dark/saturated content
 * (handwriting, diagram lines) never matches.
 */
function isStainPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  if (diff < 8) return false; // neutral grays handled by levels
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Bright cyan/blue fills and washes (b dominates, green close to blue).
  // `b >= g - 4` also catches the mint side of watercolor stains, while
  // violet ink (g well below r) and green ink (g >> b) are excluded.
  if (diff >= 12 && b > r + 12 && b >= g - 4 && lum >= CYAN_LUM_CUT) return true;
  // Light, low-saturation tints of any hue: paper washes, pill halos,
  // soft drop shadows. Saturated ink cores have diff far above 75.
  if (diff <= 75 && lum >= TINT_LUM_CUT) return true;
  return false;
}

/**
 * Same job as isStainPixel but for pixels that have ALREADY been inverted
 * (invert mode). Dark brown/navy slide backgrounds invert to light
 * blue-tinted whites — the cyan "wash" cast — and red option-key/pill fills
 * invert to bright cyan. Both are background, not content, so they go white.
 *
 * Shape: after inverting RED-family pixels both g and b tower over r; after
 * inverting brown/navy backgrounds the result is a light, low-diff tint.
 * Yellow text (→ dark blue, lum ≈ 61), orange art (→ mid blue, lum ≈ 88),
 * green ink (→ magenta, g ≪ r) and red text cores (lum ≈ 162) never match.
 */
function isInvertStainPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;
  if (diff < 8) return false; // neutral grays handled by levels
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Red/magenta-family inverse: cyan/teal fills and washes (keys, pills).
  if (diff >= 12 && g > r + 12 && b > r + 12 && lum >= INVERT_CYAN_LUM_CUT)
    return true;
  // Light tints: the inverted brown/navy background texture and washes.
  if (diff <= 75 && lum >= TINT_LUM_CUT) return true;
  return false;
}

/**
 * Pen boost — darken handwriting without touching paper.
 * Anchors at pure white (255) and multiplies the distance-to-white, so
 * light strokes (lum 120–220) get pushed much darker while paper (≥245)
 * stays white thanks to a smooth highlight-protection ramp.
 */
function penBoostValue(v: number, k: number): number {
  if (v >= 245) return v; // paper — never touched
  const gain = 1 + k * 0.7;
  let out = 255 - (255 - v) * gain;
  if (out < 0) out = 0;
  // smooth blend near the highlight edge so there is no visible seam
  const t = Math.min(1, (245 - v) / 25);
  return v + (out - v) * t;
}

/**
 * Apply the filter settings to a canvas in place.
 * `effectiveMode` lets the caller pre-resolve 'auto' (per-page) — when
 * omitted, auto pages are resolved here via a luminance measurement.
 */
export function applyFilters(
  canvas: AnyCanvas,
  s: FilterSettings,
  effectiveMode?: ColorMode,
): void {
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  if (!ctx) return;

  const mode =
    effectiveMode ?? resolveColorMode(canvas, s.colorMode);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  const strength = Math.min(100, Math.max(0, s.inkSaver)) / 100;
  const useLevels = strength > 0;
  const whiteCut = 255 - strength * 90; // e.g. 45% → 214.5 … 80% → 183
  const blackCut = strength * 55;

  const toBw = mode === 'bw';
  // Cleanup now runs in EVERY mode — in invert mode it clears the cyan cast
  // that dark brown/navy backgrounds pick up when inverted.
  const clean = s.cleanStains;
  const boost = Math.min(100, Math.max(0, s.penBoost)) / 100;
  const usePen = boost > 0 && mode !== 'bw';

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    if (mode === 'invert') {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
      if (clean && isInvertStainPixel(r, g, b)) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        continue;
      }
    } else {
      if (clean && isStainPixel(r, g, b)) {
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        continue;
      }
      if (mode === 'grayscale' || toBw) {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        r = y;
        g = y;
        b = y;
      }
      if (toBw) {
        // 150 (not 128): green ink cores sit at lum ≈ 178 — a 128 cut erases
        // entire handwritten solutions, while stains/washes (200+) still go white.
        const v = r >= 150 ? 255 : 0;
        r = v;
        g = v;
        b = v;
      }
    }

    if (useLevels) {
      r = levels(r, blackCut, whiteCut);
      g = levels(g, blackCut, whiteCut);
      b = levels(b, blackCut, whiteCut);
    }

    if (usePen) {
      r = penBoostValue(r, boost);
      g = penBoostValue(g, boost);
      b = penBoostValue(b, boost);
    }

    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    // alpha untouched (always 255 for our renders)
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * Auto-crop near-white margins so the content fills each grid cell — bigger,
 * more readable output on the same paper. Returns a NEW cropped canvas (or the
 * original when there is nothing meaningful to trim).
 */
export function trimCanvasMargins(
  canvas: AnyCanvas,
  opts?: { padding?: number; threshold?: number; maxPeel?: number },
): AnyCanvas {
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  if (!ctx) return canvas;
  const w = canvas.width;
  const h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const t = opts?.threshold ?? 247;

  const lumAt = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };

  // ---- pass 1: peel hairline frames --------------------------------------
  // Slides exported from PowerPoint (and scans) often carry a 1–4 px dark
  // keyline right at the page boundary. A plain content-bbox would include
  // that line and trim would appear to do nothing. Peel an edge inward while
  // its outermost line is (almost) solidly non-white — a frame — but never
  // more than maxPeel px per side, so full-bleed artwork loses at most ~1 mm.
  const maxPeel = opts?.maxPeel ?? 4;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  const lineInkFraction = (fixed: number, horizontal: boolean, from: number, to: number): number => {
    let inked = 0;
    let n = 0;
    for (let v = from; v < to; v++) {
      const lum = horizontal ? lumAt(v, fixed) : lumAt(fixed, v);
      if (lum < t) inked++;
      n++;
    }
    return n === 0 ? 0 : inked / n;
  };
  while (top < maxPeel && lineInkFraction(top, true, left, w - right) >= 0.9) top++;
  while (bottom < maxPeel && lineInkFraction(h - 1 - bottom, true, left, w - right) >= 0.9) bottom++;
  while (left < maxPeel && lineInkFraction(left, false, top, h - bottom) >= 0.9) left++;
  while (right < maxPeel && lineInkFraction(w - 1 - right, false, top, h - bottom) >= 0.9) right++;

  // ---- pass 2: content bbox ------------------------------------------------
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = top; y < h - bottom; y++) {
    const rowOff = y * w;
    for (let x = left; x < w - right; x++) {
      const i = (rowOff + x) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < t) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // fully blank page — nothing to crop to
  if (maxX < 0) return canvas;

  const pad = opts?.padding ?? 8;
  minX = Math.max(left, minX - pad);
  minY = Math.max(top, minY - pad);
  maxX = Math.min(w - 1 - right, maxX + pad);
  maxY = Math.min(h - 1 - bottom, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  // barely anything to gain (<2% per dimension) — avoid re-encode churn
  if ((w - cw) / w < 0.02 && (h - ch) / h < 0.02) return canvas;

  const out = createLikeCanvas(canvas, cw, ch);
  const octx = out.getContext('2d') as AnyCtx | null;
  if (!octx) return canvas;
  octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

export const COLOR_MODE_LABELS: Record<ColorMode, { title: string; hint: string }> = {
  auto: { title: 'Smart (per page)', hint: 'Dark slides inverted, light pages kept light' },
  original: { title: 'Original', hint: 'Keep colors, clean background stains' },
  invert: { title: 'Invert', hint: 'Dark slides → white pages' },
  grayscale: { title: 'Grayscale', hint: 'Remove all color' },
  bw: { title: 'Black & White', hint: 'Maximum ink saving' },
};
