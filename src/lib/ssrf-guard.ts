import dns from 'node:dns';

/**
 * SSRF guard for the cloud-import proxy.
 *
 * A URL is only fetchable when its host is provably public:
 *  - IP literals are decoded (decimal / hex / octal / IPv4-mapped IPv6) and
 *    checked against private, loopback, link-local and CGNAT ranges;
 *  - real names are resolved and EVERY returned address must be public.
 *
 * `lookup` is injectable so tests can feed canned resolutions without network.
 */

export type LookupFn = (
  host: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as private (refuse)
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export function isPrivateIPv6(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped / IPv4-compatible (::ffff:10.0.0.1)
  const mapped = ip.match(/^(::ffff:|::)((\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[2]);
  if (ip === '::' || ip === '::1') return true; // unspecified, loopback
  const first = ip.split(':')[0] ?? '';
  if (first === '') return true; // starts with "::" → loopback/prefix forms
  const v = parseInt(first, 16);
  if (Number.isNaN(v)) return true; // unparseable → refuse
  if (v >= 0xfc00 && v <= 0xfdff) return true; // unique local fc00::/7
  if (v >= 0xfe80 && v <= 0xfebf) return true; // link-local fe80::/10
  if (v >= 0xff00) return true; // multicast
  return false;
}

/** True when the hostname is safe to fetch (public address only). */
export async function isPublicHost(
  hostname: string,
  lookup: LookupFn = (h, o) => dns.promises.lookup(h, o),
): Promise<boolean> {
  let host = hostname.toLowerCase().trim();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  host = host.replace(/^\[|\]$/g, ''); // [::1] → ::1

  if (host.includes(':')) return !isPrivateIPv6(host); // IPv6 literal

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIPv4(host); // dotted quad

  // Integer encodings: decimal, hex (0x…), octal-ish — all decode to an IPv4.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    const n = parseInt(host, 0); // radix 0 → auto-detect hex/octal/decimal
    if (Number.isNaN(n) || n < 0 || n > 0xffffffff) return false;
    return !isPrivateIPv4(
      [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'),
    );
  }

  // Dotted forms with non-decimal octets (0x7f.0.0.1, 0177.0.0.1 …)
  if (/^[0-9a-fx.]+$/.test(host) && host.includes('.')) {
    const octets = host.split('.').map((o) => parseInt(o, 0));
    if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return !isPrivateIPv4(octets.join('.'));
    }
  }

  // A real name — resolve it and require EVERY address to be public.
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every(({ address, family }) =>
      family === 6 ? !isPrivateIPv6(address) : !isPrivateIPv4(address),
    );
  } catch {
    return false; // unresolvable → refuse
  }
}

/** Validate one hop of a proxy fetch: scheme + credentials + host. */
export async function validateHopUrl(u: URL): Promise<string | null> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return 'Only http(s) links are supported';
  }
  if (u.username || u.password) {
    return 'URLs with embedded credentials are not allowed';
  }
  if (!(await isPublicHost(u.hostname))) {
    return 'That host is not allowed';
  }
  return null;
}
