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

/*
 * ── Defect #8: PWA offline mode ────────────────────────────────────────────
 * README promises "works offline after first visit", but the old SW never
 * intercepted /_next/*, so an offline reload served cached HTML whose hashed
 * JS/CSS chunks were then fetched over a dead network → white screen.
 *
 * Deterministic by construction:
 *  1. wait until the SW actually CONTROLS the page (navigator.serviceWorker
 *     .controller non-null, polled with a timeout — serviceWorker.ready alone
 *     can resolve while this page is still uncontrolled);
 *  2. reload once while ONLINE: on a true first visit every chunk is fetched
 *     before the SW exists (registration waits for window load), so this
 *     SW-controlled pass is what puts the /_next/static build assets into
 *     the runtime cache;
 *  3. poll CacheStorage until every /_next/static script/stylesheet the
 *     document references is really cached (no fixed settle sleeps);
 *  4. go offline, reload, and assert the upload UI renders AND no JS/CSS
 *     build chunk failed or error'd (they must all come from the cache).
 */
test('offline reload renders the app shell from the service worker cache', async ({
  page,
  context,
}) => {
  await skipTour(page);
  await page.goto(SITE);

  // 1. The SW must be controlling this page before anything else matters.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null,
    { timeout: 30_000 },
  );

  // 2. Second load, still online: the SW now intercepts every request, so
  //    stale-while-revalidate caches each build asset as it is fetched.
  await page.reload();

  // 3. Block until the cache really holds every static chunk the document
  //    references (the SWR background writes may still be in flight).
  await page.waitForFunction(
    async () => {
      if (typeof caches === 'undefined') return false;
      const wanted = new Set<string>();
      for (const el of document.querySelectorAll('script[src], link[href]')) {
        const raw = (el as HTMLScriptElement).src || (el as HTMLLinkElement).href;
        if (!raw) continue;
        const url = new URL(raw, location.href);
        if (
          url.origin === location.origin &&
          url.pathname.includes('/_next/static/')
        ) {
          wanted.add(url.href);
        }
      }
      if (wanted.size === 0) return false;
      const cached = new Set<string>();
      for (const name of await caches.keys()) {
        if (!name.startsWith('printifier-')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) cached.add(request.url);
      }
      for (const url of wanted) if (!cached.has(url)) return false;
      return true;
    },
    null,
    { timeout: 60_000 },
  );

  // 4. Watch JS/CSS build chunks while the network is dead: they must all
  //    be served from the cache — no failures, no 4xx/5xx (the old bug
  //    surfaced as ERR_INTERNET_DISCONNECTED here, leaving a white screen).
  const chunkProblems: string[] = [];
  const isBuildChunk = (url: string) => url.includes('/_next/static/');
  page.on('response', (res) => {
    const type = res.request().resourceType();
    if (
      (type === 'script' || type === 'stylesheet') &&
      isBuildChunk(res.url()) &&
      res.status() >= 400
    ) {
      chunkProblems.push(`${res.status()} on ${res.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    const type = req.resourceType();
    if ((type === 'script' || type === 'stylesheet') && isBuildChunk(req.url())) {
      chunkProblems.push(
        `failed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`,
      );
    }
  });

  await context.setOffline(true);
  await page.reload();

  // The app shell must actually render offline — the upload dropzone is the
  // step-0 UI every other test starts from.
  await expect(page.locator('[data-dropzone]')).toBeVisible({ timeout: 30_000 });

  // page.reload() resolves on the load event, by which time every
  // document-level script/stylesheet request has settled, so the problem
  // record is complete and a plain assertion is deterministic.
  expect(chunkProblems).toEqual([]);
});
