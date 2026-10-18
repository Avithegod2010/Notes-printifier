# Security Policy

## Supported versions

| Channel | Version | Support |
|---|---|---|
| beta (`main`, `printifier.apk`) | 1.3.x | security fixes land here first |
| stable (`stable`, `printifier-stable.apk`) | 1.0.x | fixes are cherry-picked per release |

## Reporting a vulnerability

Please open a [GitHub Security Advisory](../../security/advisories/new) (private) or an
issue marked **security**. Include the affected file/route and a minimal reproduction.
You'll get a response within a week; fixes ship in the next beta build.

## Security model

**Everything user-facing is client-side.** PDF parsing, filtering, composition and OCR
run in the browser/WebView. Source files are held in memory (and, for the "recent
jobs" convenience list, in the browser's own IndexedDB). There is no account system,
no analytics SDK, no third-party network call from the web app.

Data that leaves the device:

1. **Anonymous usage stat** — after a successful job the app POSTs page/byte counts,
   color mode and layout to `/api/prints`. The `fileName` field is a **truncated
   SHA-256 hash** of the joined file names — real names are never transmitted.
2. **Cloud import (optional, self-hosted only)** — if the user pastes a Drive/Dropbox
   link, the server fetches that URL once and streams it back. The URL (not the file)
   transits the server; nothing is written to disk or logged.

**Android app**: ships the entire site inside the APK; it runs from a synthetic local
origin, requests only `INTERNET`, and `allowBackup` is disabled. The JS download bridge
sanitizes file names before writing to `Downloads/Printifier`.

## Hardening notes

- `GET /api/cloud-import` follows redirects manually and validates every hop: public
  DNS-resolved addresses only, private/link-local/CGNAT/loopback ranges blocked,
  integer/hex/octal IP encodings decoded and checked, 75 MB cap, 90 s total budget.
  Residual risk: a hostile DNS server re-resolving between validation and fetch
  (TOCTOU) — acceptable for this threat model; do not deploy the route on networks
  where that matters.
- `/api/prints` is unauthenticated by design (aggregate counts only). If you self-host
  publicly, put a rate limit in front of it.
- TypeScript errors are fatal: `tsc --noEmit` gates CI and there is no
  `ignoreBuildErrors` escape hatch. ESLint runs on every push.

## Dependency audit

Last full audit: 2026-10-18 (fresh OSV querybatch over every resolved `name@version`
in `bun.lock`; prior full audit 2026-10-14 via `bun audit`).

- **Removed unused scaffold packages** that carried advisories: `next-auth` (critical
  auth-bypass advisory, never used), `@mdxeditor/editor`, `react-syntax-highlighter`,
  `@reactuses/core`, `next-intl`, `@tanstack/react-query`, `uuid`, `date-fns`.
- **Updated `next` 16.1.3 → 16.4.0**, clearing the critical Image-Optimization RCE
  (GHSA-2xp9-vwfh-vxw4) and the Windows-hosted RCE (GHSA-p293-qw3h-jr36) advisories.
- **Removed unused `sharp`** (GHSA-wq5f-xc86-pv6w, GHSA-rgj7-g3m4-5g8c, GHSA-f88m-g3jw-g9cj —
  the three Dependabot "high" alerts; sharp is not used anywhere: the static export
  runs with `images: { unoptimized: true }`) and the unused `recharts` +
  `ui/chart.tsx` wrapper (its `lodash` chain carried advisories of its own).
- **Pinned 17 vulnerable transitive dependencies** via `package.json` → `overrides`
  (ajv, js-yaml, minimatch, brace-expansion, @humanfs/node, flatted, defu,
  deepmerge-ts, effect, nanoid, source-map-js, baseline-browser-mapping, picomatch,
  browserslist, @babel/core, postcss) — all in dev/toolchain chains, all fixed in
  their existing major lines.
- Result: **104 advisories (3 critical) → 1 (1 high)**. The single remaining finding
  is `braces 3.0.3` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, stack-exhaustion ReDoS via
  deeply nested glob patterns) which has **no upstream patch** — 3.0.3 is the newest
  release. It is used only by the ESLint glob chain at lint time on trusted local
  files, never on user input; risk is accepted until upstream ships a fix.
- The shipped client runtime (`next`, `react`, `pdfjs-dist`, `pdf-lib`, `tesseract.js`,
  `zustand`, `framer-motion`) is current and advisory-free. Self-hosters running the
  API routes should re-run `bun audit` after `bun install` and keep dependencies
  updated. Dependabot (`.github/dependabot.yml`) opens weekly update PRs.
- **About the Dependabot banner over-reporting (and its fix):** the repo previously
  used the `npm` ecosystem, which reads `package.json` ranges and ignores both
  `bun.lock` and the `overrides` block — so it alerted on OLD in-range versions of
  toolchain transitives (the three `sharp` "high" alerts via `next`'s optional deps,
  `minimatch`/`brace-expansion`/`ajv` chains) that are never actually installed.
  Re-verified on 2026-10-18 by querying the OSV database for every resolved
  `name@version` in `bun.lock` (708 packages): exactly ONE real finding — the
  accepted `braces` entry above. The config now uses Dependabot's native **`bun`
  ecosystem** (reads `bun.lock`, override-aware), which should recompute the alert
  set from resolved versions. If any phantom alert lingers after the next scan,
  dismiss it on the Security tab as **"Inaccurate"** with a pointer to this file.
  Re-verified again on **2026-10-24** (`bun audit` against the refreshed
  `bun.lock`): unchanged — exactly one finding, the accepted `braces` entry.
  `braces` 3.0.3 is still the newest upstream release (no fix available).
- **Dependabot PR policy (2026-10-24):** the five weekly GitHub-Actions bumps
  (checkout v7, upload-pages-artifact v5, configure-pages v6, codeql-action v4,
  action-gh-release v3) were merged CI-green. Major-version bumps of runtime
  libraries (typescript 7, prisma 7, eslint 10, framer-motion 14, lucide-react 1,
  react-day-picker 10, @tanstack/react-table 9, react-resizable-panels 4) are
  **deliberately deferred** and now ignored in `.github/dependabot.yml` — the
  current major lines are advisory-free. In-range minor/patch updates are applied
  on the main line with the **pinned bun 1.3.14**: Dependabot's newer bun rewrites
  `bun.lock` to `lockfileVersion: 3`, which the pinned toolchain cannot consume, so
  its lockfile-editing PRs are closed in favour of local updates.
