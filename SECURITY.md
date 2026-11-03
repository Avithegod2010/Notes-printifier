# Security Policy

## Supported versions

| Channel | Version | Support |
|---|---|---|
| beta (`main`, `printifier.apk`) | 2.4.x | security fixes land here first |
| stable (`stable`, `printifier-stable.apk`) | 2.4.x | fixes are cherry-picked per release |

## Reporting a vulnerability

Please open a [GitHub Security Advisory](../../security/advisories/new) (private) or an
issue marked **security**. Include the affected file/route and a minimal reproduction.
You'll get a response within a week; fixes ship in the next beta build.

## Security model

**Everything user-facing is client-side.** PDF parsing, filtering, composition and OCR
run in the browser/WebView. Source files are held in memory (and, for the "recent
jobs" convenience list, in the browser's own IndexedDB). There is no account system
and no analytics SDK.

**Static builds (GitHub Pages / the APK) make zero server calls** — server-only
features are compiled out at build time (`NEXT_PUBLIC_STATIC=1`, set inside
`scripts/static-export.sh` so every static build path gets it, with a CI check that
the shipped bundle contains no `/api/` references).

Data that leaves the device — **self-hosted server mode only**:

1. **Anonymous usage stat** — after a successful job the app POSTs page/byte counts,
   color mode and layout to `/api/prints`. The `fileName` field is a **16-hex
   truncated SHA-256 hash** of the joined file names — real names are never
   transmitted, and the server **rejects any request whose `fileName` is not exactly
   that hash format**, so non-app clients can't smuggle titles in either.
2. **Cloud import (optional)** — if the user pastes a Drive/Dropbox link, the server
   fetches that URL (converted to the direct-download form first) and streams the
   response straight back with no full-file buffering (declared-size responses are
   proxied as a stream; only chunked responses fall back to a 75 MB-capped buffer).
   The URL (not the file) transits the server; nothing is written to disk or logged.
   The route is rate-limited per client (10 imports / 5 min).
3. **AI routes (optional, need `Z_AI_*` credentials)** — the Print Doctor sends the
   document's file name + current settings to the configured LLM; voice commands send
   recorded audio; TTS sends the text to speak. **Without credentials these routes
   answer from local heuristics and nothing leaves the server.**
4. **Shared presets** — only when a user explicitly shares one: the settings snapshot
   (never document content) is stored server-side under a random 8-char id and
   expires after 30 days (enforced in the GET query).

**Android app**: ships the entire site inside the APK; it runs from a synthetic local
origin, declares **no permissions at all** (even `INTERNET` was removed — every
request is served from the in-APK assets or blocked with a 404), and `allowBackup` is
disabled. The JS bridge is injected only for the app's own origin, and the download
bridge sanitizes file names before writing to `Downloads/Printifier`.

## Hardening notes

- `GET /api/cloud-import` follows redirects manually and validates every hop: public
  DNS-resolved addresses only, private/link-local/CGNAT/loopback/benchmarking/
  TEST-NET/multicast/reserved ranges blocked, integer/hex/octal IP encodings decoded
  and checked — including fully-expanded hex-mapped IPv6 forms such as
  `0:0:0:0:0:ffff:7f00:1` (= 127.0.0.1), which earlier revisions missed.
  The connection then **dials the validated IP directly** (node `lookup` pinning), so
  a DNS rebinding between validation and fetch cannot re-point the socket.
- Rate limiting (`src/lib/rate-limit.ts`) treats `X-Forwarded-For` as client-spoofable:
  forwarded headers are honored only when the operator sets `TRUST_PROXY=1` behind a
  proxy that overwrites them; otherwise callers fall into per-user-agent buckets so
  users can't block each other (light abuse protection, not billing-grade).
- Settings payloads arriving over any trust boundary — QR recipe links (`?r=`), shared
  preset links (`?p=`), imported preset/backup files, the presets API (write AND read) —
  pass through the whitelist-and-clamp sanitizer in `src/lib/settings-validate.ts`.
  Unknown keys are dropped, every value is type-checked and clamped, so a crafted link
  cannot set `rows=9999` or inject an unknown color mode.
- Server mode sends `Content-Security-Policy` (`script-src` allows only
  `'wasm-unsafe-eval'` — no plain `unsafe-eval`), `frame-ancestors 'self'` +
  `X-Frame-Options: SAMEORIGIN` (override with `FRAME_ANCESTORS` if you must embed
  cross-origin), `X-Content-Type-Options`, `Referrer-Policy` and a locked-down
  `Permissions-Policy`. The production GitHub Pages host is a static export and serves
  no custom headers.
- TypeScript errors are fatal: `tsc --noEmit` gates CI (with `noImplicitAny` on) and
  there is no `ignoreBuildErrors` escape hatch. ESLint runs on every push, and the
  unit + API test suite (`bun test tests/unit tests/api`) gates CI too.
- Vendored binaries (pdf.js worker/WASM, Tesseract cores, fonts) are hash-pinned in
  `public/vendor-manifest.json`; CI re-verifies the hashes (`scripts/sync-vendor.mjs
  --check`) so a dependency bump can never silently ship a mismatched worker.

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
  runs with `images: { unoptimized: true }`). The unused `recharts` dependency and the
  `ui/chart.tsx` wrapper (its `lodash` chain carried advisories of its own) were also
  removed — as of 2026-11-03 this claim is true again: both are deleted from the code
  and `package.json`.
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
  on the main line with the **pinned bun 1.4.4** (CI + local agree): Dependabot's
  newer bun rewrites `bun.lock` formats, so its lockfile-editing PRs are closed in
  favour of local updates.
