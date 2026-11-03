import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 → fully static site in `out/` (used to package the Android
 * APK: the app is 100% client-side, so the WebView ships the whole site in its
 * assets and works completely offline). Dev server / normal runs are untouched.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

/**
 * GitHub Pages serves project sites under /<repo>/ — set
 * NEXT_PUBLIC_BASE_PATH=/Notes-printifier for that build. The APK export
 * leaves it unset (assets stay at the root inside the WebView). NEXT_PUBLIC_*
 * values are inlined into client bundles, so hand-built public URLs must be
 * prefixed with `process.env.NEXT_PUBLIC_BASE_PATH ?? ''`.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/**
 * Baseline hardening headers (server runs only — static export can't set them;
 * the WebView APK ships no server anyway).
 *  - CSP: self-only defaults; inline styles/scripts are unavoidable with Next;
 *    'wasm-unsafe-eval' is required by the self-hosted Tesseract OCR engine,
 *    blob: for pdf.js worker + canvas/audio exports. Nothing external is allowed.
 *    'unsafe-eval' was REMOVED — only the WASM escape hatch is needed, plain
 *    JS eval is not (pdf.js and Tesseract both run fine without it).
 *  - frame-ancestors / X-Frame-Options: default 'self' — blocks cross-origin
 *    clickjacking on self-hosted deployments. Operators who must embed the app
 *    in a dashboard can set FRAME_ANCESTORS ("*" or a host list) — the sandbox
 *    preview does exactly that via .env.
 *  - Permissions-Policy keeps the mic (voice input) but denies camera/geo/etc.
 */
const frameAncestors = process.env.FRAME_ANCESTORS || "'self'";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${frameAncestors}`,
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
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
  ...(basePath ? { basePath } : {}),
  reactStrictMode: true,
  experimental: {
    // Compile-time tree-shaking for the huge lucide icon barrel — only the
    // icons actually imported ship in the client bundle.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
