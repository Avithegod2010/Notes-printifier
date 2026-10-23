import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — headless smoke test only (upload → process).
 * CI (`.github/workflows/smoke.yml`) builds the static export, stages it
 * under the GitHub-Pages base path, serves it and runs this suite against
 * http://127.0.0.1:4173/Notes-printifier.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 300_000, // a 41-page deck still processes in well under this
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173/Notes-printifier',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
