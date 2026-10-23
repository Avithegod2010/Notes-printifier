'use client';

/**
 * use-share-target.ts — Web Share Target (level 1, GET).
 *
 * The manifest declares:
 *   share_target: { action: "./", method: "GET", params: { title, text, url } }
 *
 * When the installed PWA is picked from an OS share sheet, Android opens
 *   /?title=…&text=…&url=…
 * This hook reads those params, pulls out the first http(s) link, downloads
 * the PDF client-side and pushes it straight into the pipeline — one tap from
 * any chat app to a print-ready file. (POST/file shares need a server route;
 * GitHub Pages is static, so link-shares are the supported surface.)
 *
 * CORS reality check: many sites block cross-origin fetches. On failure the
 * user gets an honest toast instead of a silent nothing.
 */

import { useEffect, useRef } from 'react';

export interface ShareTargetMessages {
  progress: string;
  ok: string;
}

interface ShareTargetHandlers {
  messages: ShareTargetMessages;
  onPdf: (file: File) => void;
  onStatus: (message: string, kind: 'progress' | 'error' | 'ok') => void;
}

const FIRST_URL = /https?:\/\/[^\s"'<>()]+/i;

export function useShareTarget({ messages, onPdf, onStatus }: ShareTargetHandlers) {
  const handlersRef = useRef({ messages, onPdf, onStatus });
  // keep the latest handlers reachable inside the mount-only effect below
  useEffect(() => {
    handlersRef.current = { messages, onPdf, onStatus };
  }, [messages, onPdf, onStatus]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const shared =
        url.searchParams.get('url') ?? url.searchParams.get('text') ?? '';
      if (!shared) return;

      // strip the params so a reload / re-share doesn't re-trigger
      for (const p of ['url', 'text', 'title']) url.searchParams.delete(p);
      window.history.replaceState({}, '', url.toString());

      const m = shared.match(FIRST_URL);
      if (!m) return; // a share without any link — nothing to import
      const link = m[0];

      const { messages: msg, onPdf: deliver, onStatus: status } = handlersRef.current;
      status(msg.progress, 'progress');

      void (async () => {
        try {
          const res = await fetch(link, { mode: 'cors', redirect: 'follow' });
          const type = (res.headers.get('content-type') ?? '').toLowerCase();
          const isPdfByExt = /\.pdf(\?|#|$)/i.test(link);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!type.includes('pdf') && !isPdfByExt) {
            status('The shared link is not a PDF.', 'error');
            return;
          }
          const buf = await res.arrayBuffer();
          const rawName = decodeURIComponent(
            (link.split('/').pop() ?? 'shared.pdf').split(/[?#]/)[0] || 'shared.pdf',
          );
          const name = rawName.toLowerCase().endsWith('.pdf')
            ? rawName.slice(0, 120)
            : `${rawName.slice(0, 110)}.pdf`;
          deliver(new File([buf], name, { type: 'application/pdf' }));
          status(msg.ok, 'ok');
        } catch {
          status(
            "Couldn't download that PDF — the site blocked direct access. Download it first, then open it here.",
            'error',
          );
        }
      })();
    } catch {
      // URL parsing is best-effort
    }
  }, []);
}
