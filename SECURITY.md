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
- TypeScript build errors are currently not treated as fatal (`ignoreBuildErrors`);
  CI runs ESLint on every push.

## Dependency audit

Last full audit: 2026-10-14 (`bun audit`).

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
  is `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm, dev-chain ReDoS) which has **no upstream
  patch** — 3.0.3 is the newest release. It is used only by the ESLint glob chain at
  lint time on trusted local files; risk is accepted until upstream ships a fix.
- The shipped client runtime (`next`, `react`, `pdfjs-dist`, `pdf-lib`, `tesseract.js`,
  `zustand`, `framer-motion`) is current and advisory-free. Self-hosters running the
  API routes should re-run `bun audit` after `bun install` and keep dependencies
  updated. Dependabot (`.github/dependabot.yml`) opens weekly update PRs.
- **About the Dependabot banner over-reporting:** Dependabot alerts are computed from
  `package.json` ranges because Dependabot's Bun support cannot fully honour the
  `overrides` block. Re-verified on 2026-10-14 by querying the GitHub Advisory DB
  directly for every resolved `name@version` in `bun.lock` (682 packages): only the
  accepted `braces` finding above is real. Any additional "high" alerts shown on the
  Security tab correspond to versions that the `overrides` block has already patched
  away and can be dismissed.
