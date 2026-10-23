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
  /** Worksheet heading (defaults to English — the printed sheet is a
   *  technical artifact, so untranslated fallbacks are fine). */
  wsTitle?: string;
  /** Prompt above the four blanks. */
  wsEnter?: string;
  /** Edge labels for the blanks. */
  wsLeft?: string;
  wsRight?: string;
  wsTop?: string;
  wsBottom?: string;
  /** Where to take the four numbers. */
  wsDoctor?: string;
}

/** English fallbacks for the worksheet block (optional in `strings`). */
const WS_FALLBACK = {
  wsTitle: 'YOUR PRINTER\u2019S UNPRINTABLE BORDER',
  wsEnter: 'Write the largest number whose frame still printed on each edge:',
  wsLeft: 'Left',
  wsRight: 'Right',
  wsTop: 'Top',
  wsBottom: 'Bottom',
  wsDoctor: 'Enter these 4 numbers in Printifier\u2019s Margin Doctor.',
} as const;

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

  // --- mm rulers along ALL FOUR edges ---------------------------------------
  // Tick every 5 mm, longer + darker every 10 mm, numbers every 20 mm.
  // Reading the last tick that fully printed on ANY edge gives the hardware
  // border for that edge (top/bottom ticks run from the left edge inward).
  const tick = (x: number, y: number, dx: number, dy: number, major: boolean) => {
    page.drawLine({
      start: { x, y },
      end: { x: x + dx, y: y + dy },
      thickness: major ? 0.8 : 0.5,
      color: major ? black : gray,
    });
  };
  const RULER_LEN = 4.2 * MM;
  for (let mm = 5; mm * MM < Math.min(wPt, hPt) - 12 * MM; mm += 5) {
    const major = mm % 10 === 0;
    const d = mm * MM;
    const long = major ? RULER_LEN : RULER_LEN * 0.55;
    // left edge (ticks point right) — numbers every 20 mm
    tick(0, d, long, 0, major);
    // right edge (ticks point left)
    tick(wPt, d, -long, 0, major);
    // top edge (ticks point down)
    tick(d, hPt, 0, -long, major);
    // bottom edge (ticks point up)
    tick(d, 0, 0, long, major);
    if (major && mm % 20 === 0) {
      const label = String(mm);
      page.drawText(label, { x: 4.6 * MM, y: d - 2, size: 5.5, font, color: gray });
      page.drawText(label, {
        x: wPt - 4.6 * MM - bold.widthOfTextAtSize(label, 5.5),
        y: d - 2,
        size: 5.5,
        font,
        color: gray,
      });
      page.drawText(label, { x: d + 1, y: hPt - 4.6 * MM, size: 5.5, font, color: gray });
      page.drawText(label, { x: d + 1, y: 4.6 * MM + 4, size: 5.5, font, color: gray });
    }
  }

  // --- misalignment worksheet ------------------------------------------------
  // Four blanks the student fills in while holding the sheet: the largest
  // mm tick per edge whose tick still printed. These are exactly the 4
  // numbers the in-app Margin Doctor asks for, so reporting misalignment
  // afterwards is a 10-second transcription job.
  //
  // Placement: a white form box low on the page (below the instructions
  // block, above the bottom ruler) — the white fill masks the calibration
  // frames passing behind it so the blanks stay readable.
  const ws: Record<keyof typeof WS_FALLBACK, string> = {
    wsTitle: strings.wsTitle ?? WS_FALLBACK.wsTitle,
    wsEnter: strings.wsEnter ?? WS_FALLBACK.wsEnter,
    wsLeft: strings.wsLeft ?? WS_FALLBACK.wsLeft,
    wsRight: strings.wsRight ?? WS_FALLBACK.wsRight,
    wsTop: strings.wsTop ?? WS_FALLBACK.wsTop,
    wsBottom: strings.wsBottom ?? WS_FALLBACK.wsBottom,
    wsDoctor: strings.wsDoctor ?? WS_FALLBACK.wsDoctor,
  };
  {
    const boxH = 30 * MM;
    const boxY = 9 * MM;
    const bx = cx - 46 * MM;
    // white card + hairline border (masks the frames behind it)
    page.drawRectangle({
      x: bx,
      y: boxY,
      width: 92 * MM,
      height: boxH,
      color: rgb(1, 1, 1),
      borderColor: gray,
      borderWidth: 0.6,
    });
    let wy = boxY + boxH - 5 * MM; // title baseline
    page.drawText(ws.wsTitle, { x: bx + 4 * MM, y: wy, size: 9, font: bold, color: black });
    wy -= 5.2 * MM;
    page.drawText(ws.wsEnter, { x: bx + 4 * MM, y: wy, size: 7.5, font, color: gray });
    wy -= 7.2 * MM;
    // the four blanks: Left ___mm  Right ___mm  Top ___mm  Bottom ___mm
    const labels = [ws.wsLeft, ws.wsRight, ws.wsTop, ws.wsBottom];
    let bx2 = bx + 4 * MM;
    for (const label of labels) {
      page.drawText(label, { x: bx2, y: wy, size: 8.5, font, color: black });
      bx2 += bold.widthOfTextAtSize(label, 8.5) + 2;
      page.drawLine({
        start: { x: bx2, y: wy - 1 },
        end: { x: bx2 + 9 * MM, y: wy - 1 },
        thickness: 0.8,
        color: black,
      });
      page.drawText('mm', { x: bx2 + 9.8 * MM, y: wy, size: 7, font, color: gray });
      bx2 += 15.5 * MM;
    }
    wy -= 6.5 * MM;
    page.drawText(ws.wsDoctor, { x: bx + 4 * MM, y: wy, size: 8, font: bold, color: black });
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
