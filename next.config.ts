import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 → fully static site in `out/` (used to package the Android
 * APK: the app is 100% client-side, so the WebView ships the whole site in its
 * assets and works completely offline). Dev server / normal runs are untouched.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

/**
 * Baseline hardening headers (server runs only — static export can't set them;
 * the WebView APK ships no server anyway).
 *  - CSP: self-only defaults; inline styles/scripts are unavoidable with Next;
 *    'wasm-unsafe-eval' is required by the self-hosted Tesseract OCR engine,
 *    blob: for pdf.js worker + canvas/audio exports. Nothing external is allowed.
 *  - Permissions-Policy keeps the mic (voice input) but denies camera/geo/etc.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  },
];

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export" as const,
        distDir: ".next-static", // keep dev's .next untouched
        images: { unoptimized: true },
      }
    : {
        output: "standalone" as const,
        poweredByHeader: false,
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
  reactStrictMode: false,
};

export default nextConfig;
