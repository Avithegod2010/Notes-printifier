/**
 * HAS_SERVER_API — is this deployment backed by live API routes?
 *
 * The Next.js server (dev / standalone / Vercel) ships the /api/* handlers.
 * Static exports — the GitHub Pages build (NEXT_PUBLIC_STATIC=1, exported by
 * scripts/static-export.sh) and the offline Android APK — ship no server, so
 * server-only features (cloud preset links & QR, cloud import, community
 * stats, AI doctor / voice commands / spoken receipt) are compiled OUT
 * instead of firing doomed requests. Everything else — the entire PDF
 * pipeline, presets, history, PWA — is 100% client-side and works everywhere.
 *
 * ⚠️ IMPORTANT: consumers must NOT import this value to guard fetch() calls.
 * The bundler only constant-folds WITHIN a module, so a shared imported
 * boolean survives as a runtime check and the fetch strings stay in the
 * static bundle (scripts/static-export.sh fails builds that ship them).
 * Instead, each consumer module declares its own inline copy of the
 * expression below — `process.env.NEXT_PUBLIC_STATIC` is textually inlined
 * at build time, the comparison folds to `false`, and the guarded block is
 * dead-code-eliminated. This export remains for runtime introspection and
 * tests.
 */
export const HAS_SERVER_API = process.env.NEXT_PUBLIC_STATIC !== '1';
