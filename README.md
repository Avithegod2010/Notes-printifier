# Notes Printifier

Turn lecture PDFs into **paper- and ink-saving, print-ready PDFs** — entirely in your browser.

Slides are rendered page-by-page, cleaned up (white background, grayscale/ink-saving modes, optional OCR search layer), and re-composed into dense A4 grids (up to 8 slides per sheet, booklet mode, duplex padding). Nothing is ever uploaded: PDF.js, the compose pipeline and Tesseract OCR all run client-side.

**English + हिन्दी UI · Light/dark theme · Installable PWA · Offline Android APK.**

## Highlights

- **Print layouts** — 1×1 up to 3×3 slides per A4 sheet, margins/gaps tuned for hole-punching, **booklet mode** (saddle-stitch ordering + fold guide) and **duplex pad** (blank page so backs line up).
- **Ink-saving filters** — dark-slide inversion, 2-tone posterization, grayscale, per-channel tint removal, blue-mark cleanup, edge trim, separation lines, frameless mode.
- **Page control** — rotate, drag/button reorder, per-page exclude, name/roll-number **stamp** on every sheet.
- **Presets** — save your recipe, share it as a JSON file, import others'.
- **Cloud import** — paste a Google Drive / Dropbox link (server-side proxy, hardened against SSRF; the feature auto-hides when self-hosting without a server).
- **Privacy** — files never leave the device. History, presets and settings live in IndexedDB/localStorage. The only network call is an anonymous usage ping whose "file name" is a truncated SHA-256 hash, not the real name.
- **Savings calculator & history** — estimate sheets/₹ saved per semester, see your last jobs charted.
- **Bilingual** — every string in English and हिन्दी.

## Quick start

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint
```

## Production builds

```bash
# Fully static site (what the Android WebView ships) → .next-static/
bun run build:static

# Signed offline APKs (stable + beta channels) — see VERSIONING.md
bash android/build-apk.sh beta     # → public/printifier.apk
bash android/build-apk.sh stable   # → public/printifier-stable.apk
```

The APK pipeline is Gradle-free (`aapt2` + `ecj` + `d8` + `apksigner`) and needs the
Android build-tools 34 + a JRE; tool locations can be overridden with
`ANDROID_SDK=…` and `ECJ_JAR=…`.

### APK signing

The signing keystore (`android/printifier.keystore`) and its password are **not in the
repository**. The password is read from the `KS_PASS` env var or from
`android/signing.local` (gitignored):

```
KS_PASS=your-keystore-password
```

If the keystore doesn't exist yet it is generated on first build. Losing the
keystore means users must uninstall/reinstall to update — back it up.

## API routes (optional, self-hosting only)

The static site and the APK work with **no server at all**. When you run the full
Next.js server, two optional routes activate:

- `GET /api/cloud-import?url=…` — CORS proxy for Drive/Dropbox PDF links (75 MB cap, per-hop SSRF validation, nothing stored).
- `POST /api/prints` — anonymous usage stats (hashed file name + page counts, stored in SQLite via Prisma). Set `DATABASE_URL` (`.env`).

## Repository layout

```
src/app/                 Next.js App Router (page + optional API routes)
src/components/printifier/  the app (upload → enhance → layout → result steps)
src/lib/pdf/             PDF.js render, compose pipeline (worker), filters, OCR
src/lib/                 i18n, store (zustand), presets, theme, savings math
android/                 WebView APK source + build script (no Gradle)
scripts/                 icon generators, static-export helper
public/                  PWA assets, local pdf.js/tesseract runtimes, release APKs
```

## Versioning & releases

Two release lines from one codebase — **stable** (beginners, frozen artifacts) and
**beta** (rolling). See [VERSIONING.md](VERSIONING.md) for the release ritual and
[SECURITY.md](SECURITY.md) for the security model and reporting policy.

## License

[MIT](LICENSE)
