/**
 * Tiny fixed-window in-memory rate limiter shared by the /api routes.
 * State lives per server instance — this is light abuse protection, not
 * billing-grade accounting, so a Map is enough and keeps the app stateless.
 */
type Bucket = { count: number; reset: number }

const buckets = new Map<string, Bucket>()

function pruneExpired(now: number): void {
  // Opportunistic sweep so the map cannot grow without bound on churning IPs.
  for (const [key, bucket] of buckets) {
    if (now >= bucket.reset) buckets.delete(key)
  }
}

/** Returns true when the call is allowed; false once the caller is over quota. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  if (buckets.size > 10_000) pruneExpired(now)

  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return true
  }
  bucket.count += 1
  return bucket.count <= max
}

/**
 * Client identity for rate limiting.
 *
 * `x-forwarded-for` / `x-real-ip` are CLIENT-SUPPLIED headers — any caller
 * can set them with fetch(), so trusting them blindly lets every quota be
 * bypassed by rotating fake IPs. They are therefore honored ONLY when the
 * operator vouches for the proxy chain with TRUST_PROXY=1 (a reverse proxy
 * that OVERWRITES — not appends to — these headers).
 *
 * Without a trusted proxy there is no trustworthy per-caller address in a
 * Next.js route handler, so callers fall into a per-user-agent bucket: real
 * users no longer block each other (the old shared 'unknown' bucket), at the
 * cost that a determined abuser can rotate user agents. That trade-off is
 * acceptable for light abuse protection — see README (self-hosting env vars).
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for')
    if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`
    const real = request.headers.get('x-real-ip')
    if (real) return `ip:${real.trim()}`
  }
  const ua = request.headers.get('user-agent') ?? ''
  // Short non-crypto hash — collisions only merge a few buckets together.
  let h = 5381
  for (let i = 0; i < ua.length; i++) h = ((h * 33) ^ ua.charCodeAt(i)) >>> 0
  return `ua:${h.toString(36)}`
}
