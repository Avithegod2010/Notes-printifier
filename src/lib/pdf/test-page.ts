/**
 * test-page.ts — physical-size printer margin test sheets.
 *
 * "Real HP/Epson test prints" in web form: generate a one-page PDF at the
 * EXACT physical page size (A4 or US Letter) with calibration marks every few
 * millimetres from each edge. Print it at 100% scale ("Actual size", NOT
 * "Fit") and the closest unbroken line to the paper edge is the printer's
 * hardware-unprintable border — the number students need before trusting the
 * sheet-margin slider. Works for any inkjet/laser (HP, Epson, Canon, Brother…).
 *
 * pdf-lib loads on demand; this module must only be imported dynamically.
 */

import { PAGE_SIZES, type PageSizeOpt } from './layout-settings';

const MM = 72 / 25.4; // mm → pt

interface TestPageStrings {
  title: string;
  subtitle: string;
  howTo: string;
  check: string;
  /** Optional follow-up pointing at the in-app Margin Doctor inputs. */
  calibrate?: string;
  model: string;
  dateLabel: string;
  edgeLabel: string;
}

/**
 * Build the calibration sheet.
 * `pageSize` — only true physical sizes make sense here (a4/letter/legal/a5).
 */
export async function buildMarginTestPage(
  pageSize: Exclude<PageSizeOpt, 'original' | 'custom'>,
  strings: TestPageStrings,
  dateLabel?: string,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const [wPt, hPt] = PAGE_SIZES[pageSize];
  const page = doc.addPage([wPt, hPt]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.45, 0.45, 0.45);
  const light = rgb(0.72, 0.72, 0.72);

  // --- edge-distance rules -------------------------------------------------
  // A thin rule drawn `d` mm inside every edge. When the printer clips a rule,
  // its hardware margin is larger than d. Labels sit ON the top rule.
  const distances = [3, 5, 8, 10, 12, 15, 20, 25];
  for (const d of distances) {
    const inset = d * MM;
    if (inset * 2 > Math.min(wPt, hPt) - 40) continue; // keep the center clear
    page.drawRectangle({
      x: inset,
      y: inset,
      width: wPt - inset * 2,
      height: hPt - inset * 2,
      borderColor: d % 5 === 0 ? gray : light,
      borderWidth: d % 5 === 0 ? 0.9 : 0.55,
    });
    // label on the top rule, left of center
    page.drawText(`${d}`, {
      x: wPt / 2 - 24,
      y: hPt - inset - 1.5,
      size: 6.5,
      font: bold,
      color: black,
    });
    page.drawText('mm', {
      x: wPt / 2 - 14,
      y: hPt - inset - 1.5,
      size: 5,
      font,
      color: gray,
    });
  }

  // --- corner crop marks (5 and 10 mm) ------------------------------------
  for (const d of [5, 10]) {
    const o = d * MM;
    const len = 4 * MM;
    // four corners, two strokes each (L shapes pointing inward)
    const corners: Array<[number, number, number, number]> = [
      [o, hPt - o, 1, -1], // top-left: right + down
      [wPt - o, hPt - o, -1, -1],
      [o, o, 1, 1],
      [wPt - o, o, -1, 1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      page.drawLine({
        start: { x: cx, y: cy },
        end: { x: cx + sx * len, y: cy },
        thickness: 0.9,
        color: black,
      });
      page.drawLine({
        start: { x: cx, y: cy },
        end: { x: cx, y: cy + sy * len },
        thickness: 0.9,
        color: black,
      });
    }
  }

  // --- center crosshair + circle -------------------------------------------
  const cx = wPt / 2;
  const cy = hPt / 2;
  page.drawLine({
    start: { x: cx - 12 * MM, y: cy },
    end: { x: cx + 12 * MM, y: cy },
    thickness: 0.5,
    color: light,
  });
  page.drawLine({
    start: { x: cx, y: cy - 12 * MM },
    end: { x: cx, y: cy + 12 * MM },
    thickness: 0.5,
    color: light,
  });
  page.drawCircle({ x: cx, y: cy, size: 3 * MM, borderWidth: 0.7, borderColor: gray });
  page.drawCircle({ x: cx, y: cy, size: 0.9 * MM, color: black });

  // --- mm ruler along the left edge ----------------------------------------
  for (let mm = 10; mm * MM < hPt - 12 * MM; mm += 5) {
    const major = mm % 10 === 0;
    const y = mm * MM;
    page.drawLine({
      start: { x: 0, y },
      end: { x: (major ? 3.2 : 1.8) * MM, y },
      thickness: major ? 0.8 : 0.5,
      color: major ? black : gray,
    });
    if (major && mm % 20 === 0) {
      page.drawText(String(mm), {
        x: 3.8 * MM,
        y: y - 2,
        size: 5.5,
        font,
        color: gray,
      });
    }
  }

  // --- instructions block ----------------------------------------------------
  const sizeName = pageSize.toUpperCase();
  const lines: Array<[string, string, number]> = [
    [strings.title, 'bold', 15],
    [strings.subtitle.replace('{size}', sizeName), 'plain', 9],
    ['', 'plain', 4],
    [strings.howTo, 'plain', 8.5],
    [strings.check, 'plain', 8.5],
  ];
  if (strings.calibrate) lines.push([strings.calibrate, 'plain', 8.5]);
  lines.push(
    ['', 'plain', 4],
    [`${strings.model}: ______________________`, 'plain', 9],
    [
      `${strings.dateLabel}: ${dateLabel ?? new Date().toLocaleDateString()}`,
      'plain',
      8,
    ],
  );
  let ty = hPt / 2 + 14 * MM;
  for (const [text, kind, size] of lines) {
    if (text) {
      page.drawText(text, {
        x: cx - 46 * MM,
        y: ty,
        size,
        font: kind === 'bold' ? bold : font,
        color: black,
      });
    }
    ty -= size * 1.45;
  }

  // "Print at 100%" arrow pointing at the paper edge zone
  page.drawText(strings.edgeLabel, {
    x: cx - 18,
    y: hPt - 1.6 * MM,
    size: 5,
    font: bold,
    color: black,
  });

  return doc.save();
}
