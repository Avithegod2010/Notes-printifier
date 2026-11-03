import { NextRequest, NextResponse } from 'next/server';
import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { pinnedLookup, resolveValidatedHop } from '@/lib/ssrf-guard';
import { clientKey, rateLimit } from '@/lib/rate-limit';

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
// Unauthenticated outbound-fetch proxy — throttle actual fetches per client
// (the no-url probe stays unlimited: it is how the static client detects the
// feature and it touches nothing).
const IMPORT_RATE_MAX = 10;
const IMPORT_RATE_WINDOW_MS = 5 * 60 * 1000;

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
  /**
   * The live response — body is NOT pre-buffered. Redirect hops destroy it
   * immediately; the final response is either streamed through or consumed
   * under a hard byte cap (see GET).
   */
  stream: http.IncomingMessage;
}

function requestOnce(
  target: URL,
  timeoutMs: number,
  ip: { ip: string; family: 4 | 6 },
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      target,
      {
        method: 'GET',
        timeout: timeoutMs,
        // Dial the IP that was JUST validated — node must never re-resolve
        // the hostname here, or a DNS rebinding could swap the address
        // between validation and connection (TOCTOU).
        family: ip.family,
        lookup: pinnedLookup(ip),
        headers: {
          'user-agent': 'Mozilla/5.0 (NotesPrintifier cloud import)',
          accept: 'application/pdf,*/*;q=0.8',
        },
      },
      (res) => {
        // Resolve on headers — the body is consumed (or discarded) by the
        // caller, which knows whether this hop is a redirect or the payload.
        resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res });
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

/** Consume a response stream into a buffer under a HARD byte cap. */
async function readBounded(stream: http.IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of stream) {
    const chunk = c as Buffer;
    size += chunk.length;
    if (size > max) {
      stream.destroy();
      throw new Error('TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Wrap a live response (plus its already-consumed first chunk) into a web
 * ReadableStream with node-style backpressure and the same hard byte cap.
 * The 200 status is already committed, so an over-cap stream errors the
 * body mid-flight — the client sees a truncated download instead of a
 * 413, which is why known-size responses are length-checked first.
 */
function streamBounded(
  stream: http.IncomingMessage,
  first: Buffer,
  max: number,
): ReadableStream<Uint8Array> {
  let total = first.length;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(first));
      stream.on('data', (c: Buffer) => {
        total += c.length;
        if (total > max) {
          stream.destroy();
          controller.error(new Error('TOO_LARGE'));
          return;
        }
        controller.enqueue(new Uint8Array(c));
        // Respect the consumer's pace — pause node when the queue is full.
        if ((controller.desiredSize ?? 1) <= 0) stream.pause();
      });
      stream.on('end', () => {
        try {
          controller.close();
        } catch {
          // already errored/closed — nothing to do
        }
      });
      stream.on('error', (err) => controller.error(err));
    },
    pull() {
      stream.resume();
    },
    cancel() {
      stream.destroy();
    },
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  // probe — the client uses this to detect that cloud import exists
  if (!url) {
    return NextResponse.json({ ok: true, service: 'import' });
  }

  if (!rateLimit(`cloud-import:${clientKey(req)}`, IMPORT_RATE_MAX, IMPORT_RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many imports, try again in a few minutes' },
      { status: 429 },
    );
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

  // Drive/Dropbox share links MUST be converted to direct-download URLs
  // before the first hop — the share pages themselves are HTML, so fetching
  // them raw always ends in the 415 "returned a web page" error below.
  // The normalized URL is the URL that actually gets fetched, so it — not
  // the raw share link — goes through the SSRF guard.
  const normalized = normalizeSourceUrl(url);
  let current: URL;
  try {
    current = new URL(normalized);
  } catch {
    return NextResponse.json({ error: 'Not a valid URL' }, { status: 400 });
  }

  const firstErr = await resolveValidatedHop(current);
  if (!firstErr.ok) {
    console.warn(`[cloud-import] blocked: ${current.host} — ${firstErr.error}`);
    return NextResponse.json({ error: firstErr.error }, { status: 400 });
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;

  let result: RawResult | null = null;
  let pinned = firstErr.ip; // first hop was validated above; redirects re-pin
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return NextResponse.json({ error: 'The source took too long to respond' }, { status: 504 });
      }
      const res = await requestOnce(current, Math.min(HOP_TIMEOUT_MS, remaining), pinned);

      if (res.status >= 300 && res.status < 400) {
        // Discard the redirect body immediately — we only need Location.
        res.stream.destroy();
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
        const hopErr = await resolveValidatedHop(next);
        if (!hopErr.ok) {
          console.warn(`[cloud-import] blocked redirect hop ${next.host} — ${hopErr.error}`);
          return NextResponse.json({ error: hopErr.error }, { status: 400 });
        }
        current = next;
        pinned = hopErr.ip;
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
    result.stream.destroy();
    return NextResponse.json(
      { error: `The source responded with ${result.status}. For Drive files, set sharing to “Anyone with the link”.` },
      { status: 502 },
    );
  }

  // Google Drive sometimes answers an HTML "virus scan" interstitial for big
  // files — detect it early so we can give a useful message.
  const ctype = result.headers['content-type'] ?? '';
  if (/text\/html/i.test(String(ctype))) {
    result.stream.destroy();
    return NextResponse.json(
      { error: 'That link returned a web page, not a PDF. For Drive files, set sharing to “Anyone with the link”.' },
      { status: 415 },
    );
  }

  const declaredLength = Number(result.headers['content-length'] ?? NaN);
  const sizeKnown = Number.isFinite(declaredLength) && declaredLength >= 0;

  if (!sizeKnown) {
    // Unknown length (chunked) — the only honest option is buffering under
    // the hard cap: bounded RAM, never more than 75 MB held per request.
    let buf: Buffer;
    try {
      buf = await readBounded(result.stream, MAX_BYTES);
    } catch {
      return NextResponse.json({ error: 'File is larger than 75 MB' }, { status: 413 });
    }
    if (buf.byteLength < 100) {
      return NextResponse.json({ error: 'That file looks empty' }, { status: 415 });
    }
    const isPdf =
      /pdf/i.test(String(ctype)) ||
      (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    if (!isPdf) {
      return NextResponse.json({ error: 'That link is not a PDF file' }, { status: 415 });
    }
    return pdfResponse(new Uint8Array(buf), first);
  }

  // Size is declared — check it, then STREAM the body through (no buffering:
  // the proxy holds only the in-flight chunks, not the whole file).
  if (declaredLength > MAX_BYTES) {
    result.stream.destroy();
    return NextResponse.json({ error: 'File is larger than 75 MB' }, { status: 413 });
  }
  if (declaredLength < 100) {
    result.stream.destroy();
    return NextResponse.json({ error: 'That file looks empty' }, { status: 415 });
  }

  // PDF magic number must be validated BEFORE the 200 is committed — peek
  // at the first chunk, then let the rest flow straight through.
  let firstChunk: Buffer | undefined;
  try {
    for await (const c of result.stream) {
      firstChunk = c as Buffer;
      break;
    }
  } catch {
    return NextResponse.json({ error: 'Could not reach that link' }, { status: 502 });
  }
  if (!firstChunk || firstChunk.length === 0) {
    return NextResponse.json({ error: 'That file looks empty' }, { status: 415 });
  }
  const isPdf =
    /pdf/i.test(String(ctype)) ||
    (firstChunk[0] === 0x25 && firstChunk[1] === 0x50 && firstChunk[2] === 0x44 && firstChunk[3] === 0x46);
  if (!isPdf) {
    result.stream.destroy();
    return NextResponse.json({ error: 'That link is not a PDF file' }, { status: 415 });
  }

  const body = streamBounded(result.stream, firstChunk, MAX_BYTES);
  return pdfResponse(body, first);
}

/** Uniform 200 envelope for the proxied PDF (buffered or streamed body). */
function pdfResponse(body: BodyInit, first: URL): NextResponse {
  // A malformed % escape must be a 400-grade non-issue, never a 500.
  let rawName: string;
  try {
    rawName = decodeURIComponent(first.pathname.split('/').pop() || 'cloud-import');
  } catch {
    rawName = first.pathname.split('/').pop() || 'cloud-import';
  }
  const safeName =
    rawName
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .slice(0, 80) || 'cloud-import';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${safeName.endsWith('.pdf') ? safeName : safeName + '.pdf'}"`,
      'cache-control': 'no-store',
    },
  });
}
