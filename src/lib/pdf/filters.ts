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
 *  - deskew: estimates each page's tilt from the ink mask itself and
 *    counter-rotates tilted scans / phone photos straight BEFORE the other
 *    filters run (see estimateSkewAngle / deskewCanvas / preparePageCanvas).
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
 *    v1.8 calibration fix — light blue GEL PEN was being wiped wholesale in
 *    original mode: its stroke bodies sit at lum ≈ 182–215, exactly inside
 *    the old cyan-cut (≥182, any diff ≥ 12) and tint-cut (≥200, diff ≤ 75)
 *    kill zones, so strokes printed as broken ghosts. A pixel that is
 *    BLUE-family ink (b well above r AND g clearly below b) now survives
 *    every stain rule; the cyan-fill kill additionally requires real
 *    saturation (diff ≥ 130) so pen cores (diff 60–120) can never match.
 *
 *    v1.9 user decision — light blue ink is DARKENED, never erased
 *    (boostBlueInk, default ON). Measured against a real processed lecture
 *    PDF: blue/cyan pen stroke cores sit at lum 140–179 with saturation
 *    0.35–0.50, and the old tint-cut ERASED every stroke part at lum ≥ 200
 *    — which is exactly why strokes printed "broken" / dissociated. The
 *    blue-ink boost runs BEFORE every stain rule and the bw/grayscale
 *    conversion: blue-family ink pixels (blue or cyan pens, answer boxes,
 *    underlines — sat 0.20–0.66, lum 132–216) are re-mapped to a clearly
 *    visible deep blue (lum ≈ 65, hue preserved), anti-aliased/JPEG halos
 *    are blended 0.75 toward the same target so strokes reconnect.
 *    Saturated cyan FILLS (QUESTION pills, sat > 0.66) still die via the
 *    stain rules, green/warm inks and dark blue cores never match, and
 *    because the boost runs before thresholding, bw/grayscale output keeps
 *    blue ink as solid black instead of erasing it. Two print-safety
 *    changes ship with it: bw/grayscale pages are measured first and DARK
 *    pages are pre-inverted (thresholding a dark page used to flood the
 *    sheet black), and the factory default colorMode is now 'auto' instead
 *    of 'invert' so a light page can never turn black under defaults.
 *
 * Canvas note: every function accepts BOTH HTMLCanvasElement (main thread)
 * and OffscreenCanvas (inside the processing Web Worker), so the exact same
 * pipeline runs in either context.
 */

export type ColorMode = 'auto' | 'original' | 'invert' | 'grayscale' | 'bw';

/**
 * A user-drawn rectangle to erase, in NORMALIZED page coordinates (0–1).
 * Lets the user box a logo anywhere on the page (e.g. the PhysicsWallah
 * mark at the top-right) — not just the top header band.
 */
export interface LogoRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /**
   * DARKEN light blue/cyan INK so it prints clearly visible (default ON).
   * Blue-family strokes, answer boxes and underlines are re-mapped to a
   * deep, readable blue — and the boost runs before the stain rules and
   * before bw/grayscale, so blue ink can never be erased or broken by
   * them. Red, green, dark inks and saturated cyan decorations are never
   * touched. Optional in the type so preset recipes hardcoded before this
   * field existed keep type-checking; absent === boosted (safe default).
   */
  boostBlueInk?: boolean;
  /** Auto-crop near-white margins so content fills each grid cell. */
  trimMargins: boolean;
  /** 0–100 — darkens handwriting strokes, keeps paper white. */
  penBoost: number;
  /** Add an invisible OCR text layer so the output PDF is searchable. */
  searchable: boolean;
  /**
   * Auto deskew — detect tilted scans / phone photos and rotate each page
   * straight before the other filters run.
   *
   * Optional in the type (not required) on purpose: built-in preset recipes
   * in src/lib/presets.ts hardcode full FilterSettings literals and must keep
   * type-checking unchanged. Runtime values always carry the field because
   * every settings object is spread over defaultFilters, which sets
   * `deskew: false`.
   */
  deskew?: boolean;
  /**
   * Logo / header strip removal — white out the top N% of every page
   * (0 = off, 1–25 = band height as % of page height). Kills college logos,
   * deck titles and watermarks that sit in a predictable header zone.
   * Optional for the same reason as `deskew`: preset recipes hardcode
   * FilterSettings literals and must keep type-checking unchanged.
   */
  headerTrim?: number;
  /**
   * Normalized boxes to white out on EVERY page — picked by the user on the
   * live preview (the same logo spot repeats across a deck). Optional in the
   * type for the same preset-recipe reason as `headerTrim`.
   */
  logoRegions?: LogoRegion[];
  /**
   * Tesseract recognition languages for the searchable text layer — e.g.
   * ['eng'], ['eng','hin'], ['eng','guj'], ['eng','pan']. Optional for the same
   * preset-literal reason as deskew/headerTrim; runtime defaults to ['eng'].
   * The .traineddata.gz files are self-hosted in /public/tesseract.
   */
  ocrLangs?: string[];
  /**
   * Tesseract page-segmentation mode for OCR quality presets —
   * '3' = fully automatic (default, best for slides/mixed layouts),
   * '6' = assume one uniform text block (often better for handwritten
   * notes and single-column scans). Optional for preset-literal compat;
   * runtime defaults to '3'.
   */
  ocrPsm?: string;
}

export const defaultFilters: FilterSettings = {
  // 'auto' (smart per-page invert) is the safe factory default: dark slides
  // are inverted, light pages are left alone. The old 'invert' default
  // turned every white lecture page into a solid black print — the #1
  // "my pages came out all black" report. With 'auto' that is impossible
  // by construction; manual invert remains one tap away for dark decks.
  colorMode: 'auto',
  // Off by default (was 30, before that 45) — ink saver keeps thin
  // handwriting intact at low values but still alters every page, so new
  // sessions start untouched; the slider and presets are one tap away.
  inkSaver: 0,
  cleanStains: true,
  // Blue ink is DARKENED by default (v1.9) — faint cyan strokes were the
  // #1 legibility complaint; now they print as clearly visible deep blue.
  boostBlueInk: true,
  trimMargins: false,
  penBoost: 0,
  searchable: false,
  deskew: false,
  headerTrim: 0,
  logoRegions: [],
};

/**
 * Saturated-cyan FILL kill — QUESTION pills sit at diff ≈ 186, so the bar
 * must stay well above blue pen cores (diff 60–120) or light pens die.
 */
const CYAN_FILL_MIN_DIFF = 130;
/**
 * A pixel whose blue channel towers over red is BLUE-family INK, not paper
 * tint — the near-neutral tint kill must never touch it (light blue gel
 * pens: b−r ≈ 40–80, while washes/shadows stay within ±28).
 */
const TINT_MAX_BLUE_SHIFT = 28;
/**
 * Blue pen also has green clearly below blue (b−g ≥ 22; cyan WASHES have
 * g ≈ b). Together with TINT_MAX_BLUE_SHIFT this separates a light blue
 * stroke rgb(140,180,225) from a pale cyan wash rgb(150,220,235).
 */
const BLUE_PEN_MIN_BG_GAP = 22;
// ---------------------------------------------------------------------------
// Blue-ink boost (boostBlueInk) — calibrated on a real processed lecture
// PDF whose cyan pen strokes measured lum 140–179 / sat 0.35–0.50 and whose
// stroke middles (lum ≥ 200) had been erased by the old tint cut ("broken
// blue"). Thresholds below separate INK from background:
//   stroke cores ........... rgb(120,190,200) sat 0.40 · rgb(120,140,210)
//                            sat 0.43 · rgb(90,160,240) sat 0.63 → boost
//   QUESTION pill fills .... rgb(68,254,254) sat 0.73            → stain cut
//   pale washes/shadows .... sat ≤ 0.17, b−r < 30                → stain cut
// ---------------------------------------------------------------------------
/** Luminance the boost maps blue ink to — dark enough to print clearly. */
const BLUE_INK_TARGET_LUM = 65;
/** Below this luminance blue ink is already visible — leave it alone. */
const BLUE_INK_MIN_LUM = 132;
/** Strong tier ceiling; above it only the halo tier may act. */
const BLUE_INK_MAX_LUM = 216;
/** Saturation window for real ink (washes below, cyan pills above). */
const BLUE_INK_MIN_SAT = 0.2;
const BLUE_INK_MAX_SAT = 0.66;
/** Halo tier: anti-aliased/JPEG stroke edges — reconnected, not erased. */
const BLUE_HALO_MIN_SAT = 0.17;
const BLUE_HALO_MIN_BR_GAP = 30;
/** Halo blend — 0.75 keeps edges soft but firmly readable (~lum 100). */
const BLUE_HALO_BLEND = 0.75;
/** Blue-family gate: blue must clearly dominate red. */
const BLUE_INK_MIN_BR_GAP = 10;
/** Green-family guard: green ink has g far above b and is never touched. */
const GREEN_FAMILY_MAX_GB_GAP = 14;
/**
 * Bright-cyan cut (QUESTION pills, option keys, cyan wash cores).
 */
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
const AUTO_INVERT_THRESHOLD = 110;

/** Create a canvas of the same kind as the given one. */
function createLikeCanvas(canvas: AnyCanvas, w: number, h: number): AnyCanvas {
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
  // Blue-family ink guard — b ≫ r AND g clearly below b. Blue/violet gel
  // pens (light bodies included) must survive every rule below.
  const bluePen = b - r > TINT_MAX_BLUE_SHIFT && b - g >= BLUE_PEN_MIN_BG_GAP;
  // Bright SATURATED cyan/blue fills (pills, option keys). The high diff bar
  // keeps pen strokes (diff 60–120) out; lum ≥ CYAN_LUM_CUT keeps diagram
  // rods rgb(0,157,242) (lum ≈ 120) in.
  if (diff >= CYAN_FILL_MIN_DIFF && b > r + 12 && b >= g - 4 && lum >= CYAN_LUM_CUT)
    return true;
  // Light tints of any hue: paper washes, pill halos, soft drop shadows —
  // but never blue-family pen strokes.
  if (lum >= TINT_LUM_CUT) {
    if (bluePen) return false;
    if (diff <= 75) return true;
    // Pale-cyan decorations (diff 75–130, g ≈ b): wash-like, no content.
    if (b > r + 12 && b >= g - 4) return true;
  }
  return false;
}

/**
 * Blue-ink boost detector — deliberately SEPARATE from isStainPixel (whose
 * blue-pen guard PROTECTS blue-family pixels from stain cuts). Returns:
 *   0 → not blue ink (leave the pixel alone)
 *   1 → stroke body (lum 132–216, sat 0.20–0.66) → darken HARD to lum ≈ 65
 *   2 → stroke halo (blue-tinted, sat ≥ 0.17) → blended 0.75 toward the
 *       target so anti-aliased/JPEG edges reconnect instead of dissociating
 * A pixel matches only when ALL hold:
 *   - blue clearly dominates red            (b − r ≥ 10 → not warm/neutral)
 *   - it is NOT green-family                (g ≤ b + 14 → green ink survives)
 *   - it is faint                           (lum ≥ 132 — darker blue already
 *                                             reads fine on white paper)
 *   - saturation says INK, not background   (0.20–0.66 window; paper tints
 *                                             sit below, cyan pills above)
 * Red/orange pens (b < r), green ink, dark blue cores (lum < 132) and
 * saturated cyan fills (sat > 0.66 → stain rules) never match.
 */
function blueInkBoostTier(r: number, g: number, b: number): 0 | 1 | 2 {
  if (b - r < BLUE_INK_MIN_BR_GAP) return 0;
  if (g - b > GREEN_FAMILY_MAX_GB_GAP) return 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = (max - min) / max;
  if (sat > BLUE_INK_MAX_SAT) return 0; // cyan pill / decoration → stain cut
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < BLUE_INK_MIN_LUM) return 0; // already visible
  const halo = sat >= BLUE_HALO_MIN_SAT && b - r >= BLUE_HALO_MIN_BR_GAP;
  if (lum <= BLUE_INK_MAX_LUM) {
    if (sat >= BLUE_INK_MIN_SAT) return 1;
    return halo ? 2 : 0;
  }
  return halo ? 2 : 0;
}

/**
 * Re-map one blue-ink pixel to the target deep blue, preserving hue:
 * every channel scales by targetLum/lum, and blue gets a small extra
 * multiplier so the result still reads as BLUE rather than gray.
 */
function boostBluePixel(
  r: number,
  g: number,
  b: number,
  lum: number,
  blend: number,
): [number, number, number] {
  const k = Math.min(1, BLUE_INK_TARGET_LUM / Math.max(1, lum));
  let nr = r * k;
  let ng = g * k;
  let nb = Math.min(255, b * k * 1.15);
  if (blend < 1) {
    nr = r + (nr - r) * blend;
    ng = g + (ng - g) * blend;
    nb = b + (nb - b) * blend;
  }
  return [nr, ng, nb];
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

  // Print-safety guard: thresholding a DARK page to bw (or flattening it to
  // grayscale) floods the sheet — every background pixel sits below the cut
  // and prints near-solid black (the "page turned full black" report).
  // Dark pages are therefore inverted FIRST, so bw/grayscale output is
  // always black-on-white no matter which theme the source deck used.
  let preInvert = false;
  if (mode === 'bw' || mode === 'grayscale') {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 13) {
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    }
    if (n > 0 && sum / n < AUTO_INVERT_THRESHOLD) preInvert = true;
  }
  // Blue-ink boost runs in every non-inverted path (the invert path keeps
  // dark-slide light-blue labels, which are readable content there).
  // `!== false` keeps preset recipes that predate the field on the safe
  // default: boosted.
  const boostBlue =
    s.boostBlueInk !== false && mode !== 'invert' && !preInvert;

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

    if (mode === 'invert' || preInvert) {
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
      // Boost BEFORE the stain rules and before the gray/bw conversion:
      // darkened blue ink can never match a stain cut, and in bw/grayscale
      // it survives thresholding as solid black instead of vanishing.
      if (boostBlue) {
        const tier = blueInkBoostTier(r, g, b);
        if (tier) {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const [nr, ng, nb] = boostBluePixel(
            r,
            g,
            b,
            lum,
            tier === 1 ? 1 : BLUE_HALO_BLEND,
          );
          r = nr;
          g = ng;
          b = nb;
        }
      }
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
 *
 * The default padding scales with the render (1.5% of the shorter side,
 * minimum 8 px) so high-DPI renders keep the same visible breathing margin
 * around the content instead of a relatively shrinking hairline gap.
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

  const pad = opts?.padding ?? Math.max(8, Math.round(Math.min(w, h) * 0.015));
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

// ---------------------------------------------------------------------------
// Auto deskew — straighten tilted scans & phone photos
// ---------------------------------------------------------------------------

/** Work-resolution cap for skew estimation (longest side, in px). */
const DESKEW_WORK_MAX = 420;
/** |lum − mean| above which a pixel counts as "ink". */
const DESKEW_INK_DIFF = 36;
/** Below this ink fraction the page is blank-ish — skip the whole search. */
const DESKEW_MIN_INK = 0.005;
/** Cap on mask points fed to the search — keeps one run well under 120 ms. */
const DESKEW_MAX_POINTS = 30000;

/**
 * Estimate how many degrees a page is tilted, from its own ink mask.
 *
 * Convention: a POSITIVE angle means the content is rotated clockwise on
 * screen (text lines droop to the right); `deskewCanvas(canvas, a)` applies
 * the opposite (−a) rotation, so a positive estimate straightens with a
 * counter-clockwise turn. Returns 0 for confident-straight pages.
 *
 * How it works:
 *  1. Downscale to a ≤420 px work canvas (aspect preserved, floor dims).
 *  2. Luminance map → mean → ink mask = |lum − mean| > 36. The mask is
 *     symmetric around the mean so the SAME threshold finds dark ink on
 *     white scans AND bright text on dark slides.
 *  3. Score(angle) = variance of the horizontal row-projection profile of
 *     the mask after counter-rotating by `angle`. Straight text lines pile
 *     up into sharp dark rows → high variance; skew smears them flat.
 *  4. Coarse sweep −12…+12° (step 3°), then a fine sweep ±2.5° (step 0.5°)
 *     around the coarse winner. Rotation happens on MASK POINTS only
 *     (y' = y·cosA − x·sinA into a reused histogram) — no per-angle image
 *     copies, no per-angle allocations.
 *  5. Confidence guards: pages with <0.5% ink are skipped (blank-ish), and
 *     a candidate must beat the 0° profile by ≥8% variance or the page
 *     stays at exactly 0 (never jitter clean scans).
 *
 * Budget: ~420×315 work image, ≤30k mask points × 20 angle probes ≈ a few
 * ms on a mid-range phone — far below the 120 ms/page target.
 */
function estimateSkewAngle(canvas: AnyCanvas): number {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 16 || h < 16) return 0;

  const scale = Math.min(1, DESKEW_WORK_MAX / Math.max(w, h));
  const ww = Math.max(8, Math.floor(w * scale));
  const wh = Math.max(8, Math.floor(h * scale));

  const work = createLikeCanvas(canvas, ww, wh);
  const wctx = work.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  if (!wctx) return 0;
  // white underlay so transparent sources don't read as black "ink"
  wctx.fillStyle = '#ffffff';
  wctx.fillRect(0, 0, ww, wh);
  wctx.drawImage(canvas, 0, 0, ww, wh);

  const d = wctx.getImageData(0, 0, ww, wh).data;
  const total = ww * wh;

  // mean luminance (mask threshold anchor)
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  const mean = sum / total;

  // ink mask — built once, reused by the density filter below
  const mask = new Uint8Array(total);
  let count = 0;
  for (let y = 0; y < wh; y++) {
    const rowOff = y * ww * 4;
    for (let x = 0; x < ww; x++) {
      const i = rowOff + x * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (Math.abs(lum - mean) > DESKEW_INK_DIFF) {
        mask[y * ww + x] = 1;
        count++;
      }
    }
  }
  if (count / total < DESKEW_MIN_INK) return 0;

  // Thin-structure filter — the crucial anti-false-positive step. Skew
  // detection relies on TEXT LINES (thin strokes); photos, big headline art
  // and filled shapes are dense blobs whose diagonals can out-score real
  // line structure and produce spurious rotations (seen on a cover slide
  // with a person photo). Summed-area table over the mask: a point survives
  // only if its 9×9 neighborhood is NOT mostly ink (blobs die, strokes and
  // blob EDGES survive as thin structure).
  const iw = ww + 1;
  const sat = new Int32Array(iw * (wh + 1));
  for (let y = 0; y < wh; y++) {
    let rowSum = 0;
    for (let x = 0; x < ww; x++) {
      rowSum += mask[y * ww + x];
      sat[(y + 1) * iw + (x + 1)] = sat[y * iw + (x + 1)] + rowSum;
    }
  }
  const RADIUS = 4;
  const BLOCK = 2 * RADIUS + 1;
  const BLOCK_MAX = BLOCK * BLOCK * 0.75;
  const dense = (x: number, y: number): boolean => {
    const x0 = Math.max(0, x - RADIUS);
    const y0 = Math.max(0, y - RADIUS);
    const x1 = Math.min(ww, x + RADIUS + 1);
    const y1 = Math.min(wh, y + RADIUS + 1);
    const area = (x1 - x0) * (y1 - y0);
    const s =
      sat[y1 * iw + x1] - sat[y0 * iw + x1] - sat[y1 * iw + x0] + sat[y0 * iw + x0];
    // edge-clamped blocks shrink the denominator, so compare against the
    // area actually covered, not the full block size
    return s > area * 0.75 || s > BLOCK_MAX;
  };

  // collect center-relative THIN-ink coordinates, strided down to the cap
  const stride = Math.max(1, Math.ceil(count / DESKEW_MAX_POINTS));
  const xs = new Int16Array(Math.ceil(count / stride) + 1);
  const ys = new Int16Array(xs.length);
  let n = 0;
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      if (!mask[y * ww + x] || dense(x, y)) continue;
      if (n >= xs.length) break;
      xs[n] = x - ww * 0.5;
      ys[n] = y - wh * 0.5;
      n++;
    }
  }
  // not enough thin structure (pure photo/blob page) — no trustworthy skew
  if (n < 200) return 0;

  // variance of the row-projection profile at a candidate angle. ≤420 px
  // sides → the rotated profile never exceeds ~594 rows; one shared histogram.
  // Returns the variance plus the number of non-empty rows (a structure
  // signal — real text pages ink many rows, cover art ink few).
  const hist = new Uint32Array(640);
  const profileAt = (aDeg: number): { v: number; rows: number } => {
    const rad = (aDeg * Math.PI) / 180;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const R = Math.min(Math.floor(ww * Math.abs(s) + wh * Math.abs(c)) + 1, hist.length);
    hist.fill(0, 0, R);
    for (let k = 0; k < n; k++) {
      // counter-rotate the mask point by `aDeg` (the corrective rotation):
      // y' = y·cosA − x·sinA, back to absolute rows via +wh/2
      let row = (ys[k] * c - xs[k] * s + wh * 0.5) | 0;
      if (row < 0) row = 0;
      else if (row >= R) row = R - 1;
      hist[row]++;
    }
    let sum2 = 0;
    let rows = 0;
    for (let r = 0; r < R; r++) {
      sum2 += hist[r] * hist[r];
      if (hist[r] > 0) rows++;
    }
    const mu = n / R;
    return { v: sum2 / R - mu * mu, rows };
  };

  const base = profileAt(0);
  // Structural guard: the projection-variance trick only means "straighter
  // text lines" when the page HAS line structure. Sparse pages (title
  // slides, cover art, big photos) can beat the 0° variance with a spurious
  // angle — require a decent number of inked rows before trusting anything.
  if (base.rows < Math.max(8, wh * 0.12)) return 0;

  let bestA = 0;
  let bestV = base.v;
  // coarse sweep −9…+9° step 3° — camera/scan skews beyond 9° are rare, and
  // larger "wins" are almost always content geometry, not skew.
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const p = profileAt(i * 3);
    if (p.v > bestV) {
      bestV = p.v;
      bestA = i * 3;
    }
  }
  // fine sweep ±2.5° around the coarse winner, step 0.5°
  const center = bestA;
  for (let i = -5; i <= 5; i++) {
    const a = center + i * 0.5;
    const p = profileAt(a);
    if (p.v > bestV) {
      bestV = p.v;
      bestA = a;
    }
  }

  // confident-straight guard — clean scans must never get nudged by noise.
  // A real 1.5–3° skew on a text page lifts the projection variance by well
  // over 50%; content-geometry false positives rarely clear +35%.
  if (bestA === 0 || bestV < base.v * 1.35) return 0;
  return Math.max(-9, Math.min(9, bestA));
}

/**
 * Dominant border color of a canvas — the mode over an 8 px edge ring
 * (32-step RGB buckets, refined to the bucket's mean). Used as the deskew
 * wedge fill so rotated-in background matches the page's own background:
 * white scans keep white corners, and a dark slide rotated before its
 * invert filter doesn't grow black corner triangles in the print.
 * Returns '#ffffff' for degenerate/transparent sources.
 */
function edgeRingModeColor(canvas: AnyCanvas, ctx: AnyCtx): string {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2) return '#ffffff';
  const t = Math.max(1, Math.min(8, h >> 2));
  const s = Math.max(1, Math.min(8, w >> 2));
  const strips = [
    ctx.getImageData(0, 0, w, t),
    ctx.getImageData(0, h - t, w, t),
    ctx.getImageData(0, 0, s, h),
    ctx.getImageData(w - s, 0, s, h),
  ];
  const bucket = (r: number, g: number, b: number): number =>
    ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const counts = new Int32Array(32768);
  for (const img of strips) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      counts[bucket(d[i], d[i + 1], d[i + 2])]++;
    }
  }
  let best = 0;
  let bestN = 0;
  for (let q = 0; q < counts.length; q++) {
    if (counts[q] > bestN) {
      bestN = counts[q];
      best = q;
    }
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (const img of strips) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (bucket(d[i], d[i + 1], d[i + 2]) === best) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        a += d[i + 3];
        n++;
      }
    }
  }
  if (n === 0 || a / n < 128) return '#ffffff'; // transparent-ish source
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

/**
 * Return a NEW canvas with the content rotated by −angleDeg around the
 * center (positive estimate → counter-clockwise straightening — see
 * estimateSkewAngle for the sign convention). Bounds are expanded so rotated
 * corners never clip and dimensions use Math.floor like every other canvas
 * we create. Skews under 0.35° are left untouched (returning the SAME canvas
 * — callers can rely on identity to skip re-encoding).
 *
 * The expansion wedges are filled with the page's own dominant border color
 * (see edgeRingModeColor) — NOT plain white — so deskewed dark slides don't
 * grow black corner triangles when the invert filter runs right after.
 */
function deskewCanvas(canvas: AnyCanvas, angleDeg: number): AnyCanvas {
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 0.35) return canvas;
  const w = canvas.width;
  const h = canvas.height;
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // exact rotated bounding box is |w·cos|+|h·sin| × |w·sin|+|h·cos|;
  // floor + 1 keeps it ≥ exact so no corner is ever cut
  const W = Math.max(1, Math.floor(Math.abs(w * c) + Math.abs(h * s)) + 1);
  const H = Math.max(1, Math.floor(Math.abs(w * s) + Math.abs(h * c)) + 1);
  const out = createLikeCanvas(canvas, W, H);
  const octx = out.getContext('2d') as AnyCtx | null;
  if (!octx) return canvas;
  const srcCtx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as AnyCtx | null;
  octx.fillStyle = srcCtx ? edgeRingModeColor(canvas, srcCtx) : '#ffffff';
  octx.fillRect(0, 0, W, H);
  octx.translate(W / 2, H / 2);
  octx.rotate(-rad);
  octx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/**
 * Deskew decision for a full page — the single entry point used by the
 * pipeline AND the Enhance preview badge.
 *
 * Semantic gate: deskew exists for SCANS and PHONE PHOTOS of paper notes.
 * Dark pages (born-digital slide decks) cannot be skewed in any meaningful
 * way — and their big photo/diagonal art reliably games any variance-based
 * angle search — so dark pages are never rotated. Only light pages (paper)
 * reach the angle search, which is additionally guarded by the thin-structure
 * filter, the ±9° search cap, the ≥1.35× variance-gain gate and the
 * row-structure check inside estimateSkewAngle.
 */
export function estimateDeskewForPage(canvas: AnyCanvas): number {
  if (meanLuminance(canvas) < AUTO_INVERT_THRESHOLD) return 0; // dark page
  return estimateSkewAngle(canvas);
}

/**
 * Erase the user-drawn logo boxes — paint pure white over every normalized
 * region scaled up to this canvas. Clamped so out-of-range drags can never
 * throw. Runs FIRST in preparePageCanvas (before deskew) because the user
 * drew the boxes on the raw, un-rotated page they saw in the preview — the
 * white patch then tilts along with the page exactly like the logo does.
 */
function whiteoutRegions(canvas: AnyCanvas, regions: LogoRegion[]): AnyCanvas {
  if (!regions.length) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  if (!ctx) return canvas;
  const W = canvas.width;
  const H = canvas.height;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (const r of regions) {
    const x = Math.round(Math.min(1, Math.max(0, r.x)) * W);
    const y = Math.round(Math.min(1, Math.max(0, r.y)) * H);
    const w = Math.round(Math.min(1, Math.max(0, r.w)) * W);
    const h = Math.round(Math.min(1, Math.max(0, r.h)) * H);
    if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  return canvas;
}

/**
 * Logo / header strip removal — paint pure white over the top `pct`% of the
 * canvas. Runs AFTER the color filters (so invert can never turn the band
 * into a solid black bar) and BEFORE margin trim (so "trim margins" can pull
 * the content up into the freed space instead of leaving a dead gap).
 */
function whiteoutHeaderBand(canvas: AnyCanvas, pct: number): AnyCanvas {
  const band = Math.round(canvas.height * (Math.min(25, Math.max(0, pct)) / 100));
  if (band <= 0) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  if (!ctx) return canvas;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, band);
  ctx.restore();
  return canvas;
}

/**
 * The single entry point the whole pipeline uses for one page:
 *   deskew (optional, light pages only) → applyFilters → trim (optional).
 * `effectiveMode` passes through to applyFilters so 'auto' pages can be
 * resolved once by the caller (and reused for stats). Runs unchanged on the
 * main thread and inside the compose Web Worker.
 */
export function preparePageCanvas(
  canvas: AnyCanvas,
  s: FilterSettings,
  effectiveMode?: ColorMode,
): AnyCanvas {
  let out = canvas;
  // User-picked logo boxes go FIRST — coordinates were drawn on the raw page
  // (pre-deskew), and a white patch tracks the page through any rotation.
  if (s.logoRegions && s.logoRegions.length > 0) out = whiteoutRegions(out, s.logoRegions);
  if (s.deskew) {
    const a = estimateDeskewForPage(out);
    if (a) out = deskewCanvas(out, a);
  }
  applyFilters(out, s, effectiveMode);
  if (s.headerTrim && s.headerTrim > 0) out = whiteoutHeaderBand(out, s.headerTrim);
  if (s.trimMargins) out = trimCanvasMargins(out);
  return out;
}

/**
 * F8 core — "erased pixels" diff, worker-safe (no DOM access).
 *
 * Compares the raw render with the filtered result pixel-by-pixel and tints
 * every pixel the filter chain turned white (ink-saver levels, stain cleanup,
 * invert background) in rose. This shows the user EXACTLY which content the
 * filters are dropping — e.g. whether light handwriting survived.
 *
 * Both canvases must have identical dimensions (the preview normalizes the
 * raw render onto the result's box before calling this). Returns an ImageData
 * so the caller can paint it on any canvas kind — main thread or worker.
 */
export function buildErasedOverlayPixels(
  before: AnyCanvas,
  after: AnyCanvas,
): ImageData | null {
  const w = Math.min(before.width, after.width);
  const h = Math.min(before.height, after.height);
  if (w === 0 || h === 0) return null;

  const bctx = before.getContext('2d', { willReadFrequently: true }) as
    | AnyCtx
    | null;
  const actx = after.getContext('2d', { willReadFrequently: true }) as
    | AnyCtx
    | null;
  if (!bctx || !actx) return null;

  let b: Uint8ClampedArray;
  try {
    b = bctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  // worker-safe output canvas — draw `after`, then diff against `before`
  const out: AnyCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : document.createElement('canvas');
  const octx = out.getContext('2d', { willReadFrequently: true }) as AnyCtx | null;
  if (!octx) return null;
  octx.drawImage(after as CanvasImageSource, 0, 0);
  let oimg: ImageData;
  try {
    oimg = octx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
  const a = actx.getImageData(0, 0, w, h).data;
  const o = oimg.data;

  // rose tint (244,63,94) blended at 55% over erased pixels
  const R = 244;
  const G = 63;
  const B = 94;
  for (let i = 0; i < o.length; i += 4) {
    const lumBefore = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    const whiteAfter = a[i] >= 250 && a[i + 1] >= 250 && a[i + 2] >= 250;
    if (whiteAfter && lumBefore < 235) {
      o[i] = Math.round(o[i] * 0.45 + R * 0.55);
      o[i + 1] = Math.round(o[i + 1] * 0.45 + G * 0.55);
      o[i + 2] = Math.round(o[i + 2] * 0.45 + B * 0.55);
    }
  }
  return oimg;
}

/**
 * F8 — DOM wrapper around buildErasedOverlayPixels: returns the overlay as a
 * data URL so it can be dropped straight into an <img>. (The enhance preview
 * itself now runs the pixel core inside the filter worker — this wrapper
 * remains for the main-thread fallback.)
 */
export function buildErasedOverlay(
  before: AnyCanvas,
  after: AnyCanvas,
): string | null {
  const img = buildErasedOverlayPixels(before, after);
  if (!img) return null;
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}
