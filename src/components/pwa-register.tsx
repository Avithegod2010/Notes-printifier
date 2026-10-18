'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker (Task 7-d).
 *
 * - Only registers on HTTPS or localhost/127.0.0.1 (secure contexts).
 * - Waits for the window `load` event so it never competes with the
 *   initial page load / dev HMR.
 * - All errors are silenced (console.debug) — the PWA is a progressive
 *   enhancement and must never affect the app.
 * - Renders nothing; SSR-safe.
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const { protocol, hostname } = window.location;
    const isHttps = protocol === 'https:';
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (!isHttps && !isLocal) return;

    // GitHub Pages serves project sites under /<repo>/ — respect basePath.
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const register = () => {
      navigator.serviceWorker
        .register(`${base}/sw.js`)
        .catch((err: unknown) =>
          console.debug('[pwa] service worker registration skipped:', err),
        );
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
