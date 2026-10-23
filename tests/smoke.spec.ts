import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Headless smoke tests — the exact flow a student does on their first visit:
 * upload a lecture PDF → arrange → enhance → layout → process → download.
 * One failure here caught an OCR inversion regression before; this keeps
 * that class of bug out of main forever.
 *
 * Paths are resolved from the repo root (Playwright's working directory)
 * instead of import.meta so the spec loads cleanly under both ESM and CJS
 * module resolution.
 */

const ROOT = process.cwd();
const SAMPLE = path.join(ROOT, 'public', 'sample-lecture.pdf');
/** Full site URL — baseURL path segments get dropped by URL('/') semantics,
 *  so resolve the GitHub-Pages subpath ourselves instead. */
const SITE = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173/Notes-printifier') + '/';

/** Mark the welcome tour as seen so it never blocks a test. */
async function skipTour(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('printifier.tour', '2');
    } catch {
      // private mode — the tour then simply never blocks the flow
    }
  });
}

test('upload → process end-to-end', async ({ page }) => {
  await skipTour(page);
  await page.goto(SITE);

  // Upload the sample deck through the real (hidden) file input.
  await page.locator('input[type="file"]').first().setInputFiles(SAMPLE);

  // Arrange step — thumbnails render, then continue.
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueBtn).toBeVisible({ timeout: 90_000 });
  await continueBtn.click();

  // Enhance step — defaults are fine for smoke purposes.
  await expect(continueBtn).toBeVisible({ timeout: 60_000 });
  await continueBtn.click();

  // Layout step — run the full pipeline.
  const processBtn = page.getByRole('button', { name: /Process File/i });
  await expect(processBtn).toBeVisible({ timeout: 60_000 });
  await processBtn.click();

  // Result step — the finished PDF is ready to download (generous timeout:
  // the compose worker + OCR-free pipeline on a 41-page deck).
  const download = page
    .getByRole('link', { name: /Download PDF/i })
    .or(page.getByRole('button', { name: /Download PDF/i }));
  await expect(download).toBeVisible({ timeout: 240_000 });
});

/**
 * OCR-enabled run — asserts the confidence REPORT CARD appears.
 *
 * Catches the next OCR regression class automatically: if the Tesseract pass
 * silently bails (like the old isActive-inversion bug) or the report card
 * stops rendering, this test goes red instead of waiting for a manual
 * click-through.
 *
 * Uses a tiny 2-page TEXT PDF generated at test time (pdf-lib) so the OCR
 * pass takes seconds, not minutes, in CI.
 */
test('OCR-enabled run shows the confidence report card', async ({ page }) => {
  await skipTour(page);

  // Build a text-heavy fixture: real words on a white page, two pages long.
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = pdf.addPage([595.28, 841.89]);
    p.drawText('Printifier OCR smoke fixture', { x: 48, y: 780, size: 20, font });
    const para =
      'The quick brown fox jumps over the lazy dog while counting the twenty six ' +
      'letters of the alphabet. Students print lecture notes to save paper and ' +
      'ink every single exam week without uploading files anywhere.';
    for (let line = 0; line < 8; line++) {
      p.drawText(para, { x: 48, y: 720 - line * 34, size: 12, font });
    }
  }
  const bytes = await pdf.save();
  const fixture = path.join(ROOT, 'tests', 'ocr-fixture.pdf');
  writeFileSync(fixture, bytes);

  await page.goto(SITE);
  await page.locator('input[type="file"]').first().setInputFiles(fixture);

  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueBtn).toBeVisible({ timeout: 90_000 });
  await continueBtn.click();

  // Enhance step — turn the searchable OCR layer ON. The switch lives in the
  // collapsed "Advanced" section, so expand it first.
  await expect(continueBtn).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Advanced/i }).first().click();
  const ocrSwitch = page.getByTestId('ocr-switch');
  await expect(ocrSwitch).toBeVisible({ timeout: 30_000 });
  await ocrSwitch.click();

  // OCR Bench (inside the Print Doctor card, same step) — run the PSM 3 vs
  // PSM 6 benchmark on the fixture's first page and assert both rows render
  // with real numbers plus the "adopt the winner" action. Guards the bench
  // pipeline (worker spawn → dual recognition → winner pick) the same way
  // the report-card assertion guards the OCR layer itself.
  const benchRun = page.getByTestId('ocr-bench-run');
  await expect(benchRun).toBeVisible({ timeout: 30_000 });
  await benchRun.click();
  const benchApply = page.getByTestId('ocr-bench-apply');
  await expect(benchApply).toBeVisible({ timeout: 180_000 });
  // both result rows render inside the table (scoped to <td> so the bench
  // title "OCR Bench — PSM 3 vs 6" can't satisfy the assertion)
  await expect(page.locator('td').filter({ hasText: /PSM 3/ })).toBeVisible();
  await expect(page.locator('td').filter({ hasText: /PSM 6/ })).toBeVisible();

  await continueBtn.click();

  // Layout → process.
  const processBtn = page.getByRole('button', { name: /Process File/i });
  await expect(processBtn).toBeVisible({ timeout: 60_000 });
  await processBtn.click();

  // Result — the OCR quality report card must surface (avg confidence badge).
  await expect(page.getByTestId('ocr-report-card')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('ocr-report-card')).toContainText(/confidence/i, {
    ignoreCase: true,
  });
});
