/**
 * Tiny fixed-window in-memory rate limiter shared by the /api/ai routes.
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

/** Best-effort client identity: first proxy hop, then x-real-ip, else shared bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}
