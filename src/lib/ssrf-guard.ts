import dns from 'node:dns';
import type { LookupAddress } from 'node:dns';

/**
 * SSRF guard for the cloud-import proxy.
 *
 * A URL is only fetchable when its host is provably public:
 *  - IP literals are decoded (decimal / hex / octal / IPv4-mapped IPv6,
 *    including fully-expanded hex-mapped forms such as
 *    `0:0:0:0:0:ffff:7f00:1` = 127.0.0.1) and checked against private,
 *    loopback, link-local, CGNAT, benchmarking, documentation and
 *    multicast/reserved ranges;
 *  - real names are resolved and EVERY returned address must be public;
 *    the first public address is returned as the PINNED IP so the actual
 *    connection dials the validated address instead of re-resolving the
 *    name (which would reopen a DNS-rebinding window).
 *
 * `lookup` is injectable so tests can feed canned resolutions without network.
 */

export type LookupFn = (
  host: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

/** The connection target produced by a successful validation. */
export interface ValidatedIp {
  ip: string;
  family: 4 | 6;
}
export type HopValidation = { ok: true; ip: ValidatedIp } | { ok: false; error: string };

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as private (refuse)
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, limited broadcast
  return false;
}

/**
 * Expand any IPv6 spelling (compact `::`, embedded dotted quads, brackets)
 * into exactly 8 numeric hextets — or null when unparseable.
 */
function expandIPv6(raw: string): number[] | null {
  let ip = raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (!/^[0-9a-f:.]+$/.test(ip)) return null;
  // Embedded dotted-quad tail (::ffff:1.2.3.4) → two hex hextets.
  const tail = ip.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const o = tail[2].split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n > 255)) return null;
    ip = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null; // more than one "::"
  const head = halves[0] ? halves[0].split(':') : [];
  const back = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const fill = 8 - head.length - back.length;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const groups = [...head, ...Array<(typeof head)[number]>(Math.max(0, fill)).fill('0'), ...back];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIPv6(raw: string): boolean {
  const h = expandIPv6(raw);
  if (!h) return true; // unparseable → refuse
  if (h.every((x) => x === 0)) return true; // :: (unspecified)
  const v4Tail = [(h[6] >> 8) & 255, h[6] & 255, (h[7] >> 8) & 255, h[7] & 255];
  // IPv4-embedded forms: first FIVE hextets zero covers ::1 (loopback),
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) — in EVERY spelling
  // (dotted-quad tail or hex, compact or fully expanded). Checking only the
  // compact spellings is exactly the bypass this guard used to have:
  // `0:0:0:0:0:ffff:7f00:1` (= 127.0.0.1) slipped through as "public".
  if (h.slice(0, 5).every((x) => x === 0)) {
    if (h[5] === 0 && h[6] === 0 && h[7] === 1) return true; // ::1 loopback
    if (h[5] === 0xffff || h[5] === 0) {
      if (isPrivateIPv4(v4Tail.join('.'))) return true;
    }
  }
  const first = h[0];
  if (first >= 0xfc00 && first <= 0xfdff) return true; // unique local fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10
  if (first >= 0xff00) return true; // multicast
  if (first === 0x2001 && h[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if (first === 0x0100) return true; // discard-only 100::/64
  if (first === 0x2002) return true; // 6to4 2002::/16 — embeds a v4 host we don't validate
  return false;
}

/** Decode an IPv4 host spelled as decimal / hex / octal / mixed octets → quad. */
function decodeIPv4Host(host: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host; // dotted quad
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    const n = parseInt(host, 0); // radix 0 → auto-detect hex/octal/decimal
    if (Number.isNaN(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  // Dotted forms with non-decimal octets (0x7f.0.0.1, 0177.0.0.1 …)
  if (/^[0-9a-fx.]+$/.test(host) && host.includes('.')) {
    const octets = host.split('.').map((o) => parseInt(o, 0));
    if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return octets.join('.');
    }
  }
  return null;
}

/**
 * Resolve a hostname to the public IP the connection may use — the FIRST
 * public address from DNS (all addresses must already be public), or the
 * decoded literal itself. Returns null when the host is not provably public.
 */
async function resolvePublicIp(
  hostname: string,
  lookup: LookupFn = (h, o) => dns.promises.lookup(h, o),
): Promise<ValidatedIp | null> {
  let host = hostname.toLowerCase().trim();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return null;
  }
  host = host.replace(/^\[|\]$/g, ''); // [::1] → ::1

  if (host.includes(':')) {
    // IPv6 literal
    return isPrivateIPv6(host) ? null : { ip: host, family: 6 };
  }

  const v4 = decodeIPv4Host(host);
  if (v4) return isPrivateIPv4(v4) ? null : { ip: v4, family: 4 };

  // A real name — resolve it and require EVERY address to be public.
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return null;
    for (const { address, family } of addrs) {
      const bad = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
      if (bad) return null;
    }
    const first = addrs[0];
    return { ip: first.address, family: first.family === 6 ? 6 : 4 };
  } catch {
    return null; // unresolvable → refuse
  }
}

/**
 * Validate one hop of a proxy fetch: scheme + credentials + host, and
 * resolve the host to the PINNED public IP the request must dial.
 */
export async function resolveValidatedHop(
  u: URL,
  lookup?: LookupFn,
): Promise<HopValidation> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) links are supported' };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed' };
  }
  const ip = await resolvePublicIp(u.hostname, lookup);
  if (!ip) {
    return { ok: false, error: 'That host is not allowed' };
  }
  return { ok: true, ip };
}

/** Validate one hop of a proxy fetch: scheme + credentials + host. */
export async function validateHopUrl(
  u: URL,
  lookup?: LookupFn,
): Promise<string | null> {
  const res = await resolveValidatedHop(u, lookup);
  return res.ok ? null : res.error;
}

/** Build a node:http `lookup` option that dials ONLY the validated IP. */
export function pinnedLookup(ip: ValidatedIp): NonNullable<
  import('node:http').RequestOptions['lookup']
> {
  return (
    _hostname: string,
    options: { all?: boolean } | ((err: Error | null, address: string, family: number) => void),
    cb?: (err: Error | null, address: string, family: number) => void,
  ) => {
    // Support both lookup signatures node may call us with.
    if (typeof options === 'function') {
      options(null, ip.ip, ip.family);
      return;
    }
    const callback = cb as (err: Error | null, address: string | LookupAddress[], family?: number) => void;
    if (options && options.all) {
      callback(null, [{ address: ip.ip, family: ip.family } as LookupAddress]);
    } else {
      callback(null, ip.ip, ip.family);
    }
  };
}
