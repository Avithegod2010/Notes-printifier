/**
 * layout-settings.ts — pure layout types, defaults and math.
 *
 * Split out of compose-core.ts so that UI code (stores, preset helpers,
 * layout step) can import layout settings WITHOUT pulling the pdf-lib
 * composition pipeline into the initial JS bundle. compose-core re-exports
 * everything from here, so existing imports keep working.
 *
 * This module must stay dependency-free (no pdf-lib, no pdf.js, no canvas).
 */

export type PageSizeOpt = 'a4' | 'letter' | 'original';
export type QualityOpt = 'low' | 'medium' | 'high';

export interface LayoutSettings {
  pageSize: PageSizeOpt;
  orientation: 'portrait' | 'landscape';
  rows: number;
  cols: number;
  separators: boolean;
  pageNumbers: boolean;
  quality: QualityOpt;
  /** Booklet arrangement: 2-up landscape, saddle-stitch page order. */
  booklet: boolean;
  /** Duplex helper: append one blank page when the sheet count is odd. */
  duplexPad: boolean;
  /** Stamp the SOURCE page number (e.g. "p.12") on every placed slide. */
  slideNumbers?: boolean;
  /** 3-up handout: slide on the left, ruled note lines on the right. */
  noteLines?: boolean;
  /** Custom render DPI (72–300). null/undefined = follow the quality preset. */
  customDpi?: number | null;
  /** Optional small label printed bottom-left of every sheet. */
  footerLabel?: string;
  /** Name stamp — ownership mark printed bottom-right of every sheet
   *  (the advertised "Name Stamp" feature). Empty/undefined = off. */
  nameStamp?: string;
  /** Prepend a cover page listing the source documents (batch handout). */
  coverSheet?: boolean;
  /** Soft cap for the final PDF size (MB). 0/null = off. The store lowers
   *  JPEG quality and re-composes until the output fits. */
  sizeTargetMB?: number | null;
}

export const defaultLayout: LayoutSettings = {
  pageSize: 'a4',
  orientation: 'portrait',
  rows: 3,
  cols: 1,
  separators: true,
  pageNumbers: true,
  quality: 'medium',
  booklet: false,
  duplexPad: false,
  slideNumbers: false,
  noteLines: false,
  customDpi: null,
  coverSheet: false,
  sizeTargetMB: null,
  nameStamp: '',
};

export interface ComposeItem {
  docId: number;
  pageNumber: number; // 1-based within its source document
  rotation: number; // user rotation 0/90/180/270
  /** Renders an intentional empty (white) cell — used for booklet padding. */
  blank?: boolean;
}

/**
 * Canonical lookup key for one unique slide: `docId:pageNumber:rotation`.
 * The OCR/repaint passes and the compose loop MUST agree on this format, so
 * both sides build keys through this helper (they can never drift).
 */
export function composeItemKey(
  item: Pick<ComposeItem, 'docId' | 'pageNumber' | 'rotation'>,
): string {
  return `${item.docId}:${item.pageNumber}:${item.rotation}`;
}

export interface CoverSheetData {
  /** App title, drawn big at the top. */
  title: string;
  /** Usually the date. */
  subtitle: string;
  /** Heading above the document list. */
  contentsHeading: string;
  /** One entry per source document, in merge order. */
  entries: Array<{ name: string; label: string }>;
  /** Small footer line. */
  footnote: string;
}

export interface Placement {
  /** Index into ComposeOptions.items (the non-blank slide this rect belongs to). */
  itemIndex: number;
  /** Output page number (1-based). */
  outPage: number;
  /** Rect in PDF points, origin bottom-left of the output page. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const QUALITY: Record<QualityOpt, { dpi: number; jpeg: number }> = {
  low: { dpi: 96, jpeg: 0.5 },
  medium: { dpi: 150, jpeg: 0.68 },
  high: { dpi: 210, jpeg: 0.85 },
};

export const DPI_MIN = 72;
export const DPI_MAX = 300;

/** JPEG quality that tracks the DPI — sharper render, slightly richer encode. */
export function jpegForDpi(dpi: number): number {
  const t = (Math.min(DPI_MAX, Math.max(DPI_MIN, dpi)) - QUALITY.low.dpi) /
    (QUALITY.high.dpi - QUALITY.low.dpi);
  return Math.round((0.5 + t * 0.38) * 100) / 100;
}

/**
 * Effective render dpi + JPEG quality for a layout: the custom DPI slider
 * wins when set, otherwise the quality preset decides.
 */
export function resolveQuality(layout: Pick<LayoutSettings, 'quality' | 'customDpi'>): {
  dpi: number;
  jpeg: number;
  custom: boolean;
} {
  if (layout.customDpi && layout.customDpi >= DPI_MIN) {
    const dpi = Math.min(DPI_MAX, Math.round(layout.customDpi));
    return { dpi, jpeg: jpegForDpi(dpi), custom: true };
  }
  const q = QUALITY[layout.quality];
  return { dpi: q.dpi, jpeg: q.jpeg, custom: false };
}

export const PAGE_SIZES: Record<Exclude<PageSizeOpt, 'original'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export function estimateOutputPages(pageCount: number, layout: LayoutSettings): number {
  if (layout.booklet) return bookletOutputPages(pageCount);
  const perPage = Math.max(1, layout.rows * layout.cols);
  const base = Math.max(1, Math.ceil(pageCount / perPage));
  return layout.coverSheet ? base + 1 : base;
}

/** Booklet output = one landscape sheet side per 2 booklet pages, padded to 4. */
export function bookletOutputPages(count: number): number {
  if (count <= 0) return 0;
  const padded = Math.ceil(count / 4) * 4;
  return padded / 2;
}

/**
 * Saddle-stitch order for a fold-in-half booklet: sheet fronts/backs arranged
 * so that printing 2-up landscape, duplex (flip on short edge), then folding
 * once yields a correctly ordered booklet. Pads to a multiple of 4 with blank
 * cells at the END of the booklet.
 */
export function buildBookletItems(items: ComposeItem[]): ComposeItem[] {
  const total = items.length;
  if (total === 0) return [];
  const padded = Math.ceil(total / 4) * 4;
  const out: ComposeItem[] = [];
  for (let j = 1; j <= padded / 2; j++) {
    let left: number;
    let right: number;
    if (j % 2 === 1) {
      const m = (j + 1) / 2; // sheet number, front side
      left = padded - 2 * m + 2;
      right = 2 * m - 1;
    } else {
      const m = j / 2; // sheet number, back side
      left = 2 * m;
      right = padded - 2 * m + 1;
    }
    for (const p of [left, right]) {
      out.push(
        p <= total
          ? items[p - 1]
          : { docId: 0, pageNumber: 0, rotation: 0, blank: true },
      );
    }
  }
  return out;
}
