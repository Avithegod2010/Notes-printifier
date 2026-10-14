import type { NextConfig } from "next";

/**
 * STATIC_EXPORT=1 → fully static site in `out/` (used to package the Android
 * APK: the app is 100% client-side, so the WebView ships the whole site in its
 * assets and works completely offline). Dev server / normal runs are untouched.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export" as const,
        distDir: ".next-static", // keep dev's .next untouched
        images: { unoptimized: true },
      }
    : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
