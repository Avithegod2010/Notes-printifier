/**
 * HAS_SERVER_API — is this deployment backed by live API routes?
 *
 * The Next.js server (dev / standalone / Vercel) ships the /api/* handlers.
 * Static exports — the GitHub Pages build (NEXT_PUBLIC_STATIC=1) and the
 * offline Android APK — ship no server, so server-only features (cloud
 * preset links & QR, cloud import, community stats, AI doctor / voice
 * commands / spoken receipt) hide themselves instead of firing doomed
 * requests. Everything else — the entire PDF pipeline, presets, history,
 * PWA — is 100% client-side and works everywhere.
 */
export const HAS_SERVER_API = process.env.NEXT_PUBLIC_STATIC !== '1';
