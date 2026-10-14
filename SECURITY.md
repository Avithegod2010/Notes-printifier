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
