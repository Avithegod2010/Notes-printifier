/*
 * Notes Printifier — service worker (Task 7-d)
 *
 * Strategy:
 *  - Precache the app shell ('/', manifest, icons) on install.
 *  - Navigations: network-first with cache fallback.
 *  - Same-origin static assets (icons, manifest, pdf worker, sample PDFs):
 *    stale-while-revalidate.
 *  - NEVER intercept: non-GET requests, cross-origin requests, /_next/*
 *    (so dev HMR and build assets always pass straight through), or /api/*.
 *
 * Every cache operation is wrapped in try/catch: a failed cache op must
 * never break the page.
 */

const CACHE_NAME = 'printifier-v4';

// GitHub Pages hosts project sites under /<repo>/ — derive the base from the
// registration scope so the same file works at the root (dev, APK) and under
// a subpath. On a root deployment this is ''.
const BASE = new URL(self.registration.scope).pathname.replace(/\/+$/, '');

const PRECACHE_URLS = [
  `${BASE}/`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/icon-maskable-512.png`,
  `${BASE}/icons/apple-touch-icon.png`,
];

// Same-origin static assets eligible for stale-while-revalidate.
const SWR_PATH_PATTERNS = [
  /^\/icons\/.+\.png$/,
  /^\/manifest\.webmanifest$/,
  /^\/pdf\.worker\.min\.mjs$/,
  /^\/sample-.+\.pdf$/,
  // OCR traineddata + Unicode text-layer fonts — cached after first use so
  // Hindi/Tamil OCR keeps working fully offline.
  /^\/tesseract\/.+\.traineddata\.gz$/,
  /^\/fonts\/NotoSans(Devanagari|Tamil)-Regular\.ttf$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // allSettled: one failed precache entry must not break the install.
        await Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })),
          ),
        );
      } catch (err) {
        // Never break install because of a cache failure.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        );
      } catch (err) {
        // Ignore cache cleanup failures.
      }
      await self.clients.claim();
    })(),
  );
});

async function updateCache(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, fresh.clone());
    }
  } catch (err) {
    // Background refresh failures are fine.
  }
}

async function fromCache(request) {
  try {
    return await caches.match(request);
  } catch (err) {
    return undefined;
  }
}

/** Network-first (used for navigations), falling back to the cache. */
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    try {
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, fresh.clone());
      }
    } catch (err) {
      // Ignore cache write failures.
    }
    return fresh;
  } catch (err) {
    try {
      const cached =
        (await fromCache(request)) || (await fromCache(`${BASE}/`));
      if (cached) return cached;
    } catch (err2) {
      // Fall through to the offline response.
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/** Stale-while-revalidate: serve from cache, refresh in the background. */
async function staleWhileRevalidate(request) {
  const cached = await fromCache(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    return fresh;
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  try {
    const request = event.request;

    // Never intercept non-GET requests.
    if (request.method !== 'GET') return;

    let url;
    try {
      url = new URL(request.url);
    } catch (err) {
      return;
    }

    // Same-origin GET only.
    if (url.origin !== self.location.origin) return;

    // Compare below the deployment base (GitHub Pages /<repo>/ prefix).
    const path =
      BASE && url.pathname.startsWith(`${BASE}/`)
        ? url.pathname.slice(BASE.length)
        : url.pathname;

    // NEVER intercept Next.js build/HMR assets (dev would break).
    if (path.startsWith('/_next/')) return;

    // API routes must always hit the network.
    if (path.startsWith('/api/')) return;

    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request));
      return;
    }

    if (SWR_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      // Kick off the background refresh synchronously so it survives.
      const refresh = updateCache(request);
      try {
        event.waitUntil(refresh);
      } catch (err) {
        // waitUntil is best-effort; SWR still works without it.
      }
      event.respondWith(staleWhileRevalidate(request));
    }
    // Everything else: default browser handling (no interception).
  } catch (err) {
    // A failing service worker must never break the page.
  }
});
