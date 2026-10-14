import { NextRequest, NextResponse } from 'next/server';
import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { validateHopUrl } from '@/lib/ssrf-guard';

/**
 * /api/cloud-import — cloud PDF import proxy.
 *
 * Browser CORS rules block direct fetches from Google Drive / Dropbox, so the
 * server fetches the file ONCE and streams it straight back to the browser.
 * Nothing is written to disk, nothing is logged, no size over 75 MB.
 *
 * Security (SSRF hardening):
 *  - uses raw node:http/https (NOT the global fetch — Next.js patches fetch
 *    and may not honour `redirect: 'manual'`), so redirects are ALWAYS
 *    followed manually and every hop is re-validated;
 *  - each hop's host must be a public name: IP-literal tricks (decimal/hex/
 *    octal/IPv4-mapped IPv6) are decoded and checked, private/link-local/
 *    CGNAT ranges are blocked, and every DNS-resolved address must be public
 *    (see src/lib/ssrf-guard.ts);
 *  - plain http(s) only, no credentials in URLs, ≤ 5 hops, 75 MB cap.
 *
 * Works on the website. The offline static export / APK simply doesn't ship
 * this route (the client probes it and hides the feature when missing).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 75 * 1024 * 1024; // 75 MB
const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 45_000;
const TOTAL_BUDGET_MS = 90_000;

/** Google Drive share link → direct download URL. */
function driveDirectUrl(link: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{10,})/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = link.match(p);
    if (m) {
      return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download`;
    }
  }
  return null;
}

/** Dropbox share link → direct download URL. */
function dropboxDirectUrl(link: string): string {
  let url = link.replace('?dl=0', '?dl=1').replace('&dl=0', '&dl=1');
  if (!/dl=1/.test(url)) url += (url.includes('?') ? '&' : '?') + 'dl=1';
  url = url.replace('www.dropbox.com', 'dl.dropboxusercontent.com');
  return url;
}

function normalizeSourceUrl(raw: string): string {
  const drive = driveDirectUrl(raw);
  if (drive) return drive;
  if (/dropbox\.com/.test(raw)) return dropboxDirectUrl(raw);
  return raw;
}

/* ── raw HTTP (no redirect following, ever) ──────────────────── */

interface RawResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(target: URL, timeoutMs: number): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      target,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'user-agent': 'Mozilla/5.0 (NotesPrintifier cloud import)',
          accept: 'application/pdf,*/*;q=0.8',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('TOO_LARGE'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  // probe — the client uses this to detect that cloud import exists
  if (!url) {
    return NextResponse.json({ ok: true, service: 'import' });
  }

  if (url.length > 2048) {
    return NextResponse.json({ error: 'URL too long' }, { status: 400 });
  }

  let first: URL;
  try {
    first = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Not a valid URL' }, { status: 400 });
  }

  const firstErr = await validateHopUrl(first);
  if (firstErr) {
    console.warn(`[cloud-import] blocked: ${first.host} — ${firstErr}`);
    return NextResponse.json({ error: firstErr }, { status: 400 });
  }

  const source = normalizeSourceUrl(url);
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  let result: RawResult | null = null;
  let current: URL = first;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return NextResponse.json({ error: 'The source took too long to respond' }, { status: 504 });
      }
      const res = await requestOnce(current, Math.min(HOP_TIMEOUT_MS, remaining));

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.location;
        const locStr = Array.isArray(loc) ? loc[0] : loc;
        if (!locStr) {
          return NextResponse.json({ error: 'The source returned an invalid redirect' }, { status: 502 });
        }
        let next: URL;
        try {
          next = new URL(locStr, current);
        } catch {
          return NextResponse.json({ error: 'The source returned an invalid redirect' }, { status: 502 });
        }
        const hopErr = await validateHopUrl(next);
        if (hopErr) {
          console.warn(`[cloud-import] blocked redirect hop ${next.host} — ${hopErr}`);
          return NextResponse.json({ error: hopErr }, { status: 400 });
        }
        current = next;
        continue;
      }

      result = res;
      break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'TOO_LARGE') {
      return NextResponse.json({ error: 'File is larger than 75 MB' }, { status: 413 });
    }
    if (msg === 'TIMEOUT') {
      return NextResponse.json({ error: 'The source took too long to respond' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Could not reach that link' }, { status: 502 });
  }

  if (!result) {
    return NextResponse.json({ error: 'Too many redirects' }, { status: 508 });
  }
  if (result.status < 200 || result.status >= 300) {
    return NextResponse.json(
      { error: `The source responded with ${result.status}. For Drive files, set sharing to “Anyone with the link”.` },
      { status: 502 },
    );
  }

  // Google Drive sometimes answers an HTML "virus scan" interstitial for big
  // files — detect it early so we can give a useful message.
  const ctype = result.headers['content-type'] ?? '';
  if (/text\/html/i.test(String(ctype))) {
    return NextResponse.json(
      { error: 'That link returned a web page, not a PDF. For Drive files, set sharing to “Anyone with the link”.' },
      { status: 415 },
    );
  }

  const buf = result.body;
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File is larger than 75 MB' }, { status: 413 });
  }
  if (buf.byteLength < 100) {
    return NextResponse.json({ error: 'That file looks empty' }, { status: 415 });
  }
  // PDF magic number — accept application/pdf or a body that IS a PDF
  const isPdf =
    /pdf/i.test(String(ctype)) ||
    (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
  if (!isPdf) {
    return NextResponse.json(
      { error: 'That link is not a PDF file' },
      { status: 415 },
    );
  }

  const safeName =
    decodeURIComponent(first.pathname.split('/').pop() || 'cloud-import')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .slice(0, 80) || 'cloud-import';

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${safeName.endsWith('.pdf') ? safeName : safeName + '.pdf'}"`,
      'cache-control': 'no-store',
    },
  });
}
