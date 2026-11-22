import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Access gate for the paid AI routes (`/api/ai/{doctor,transcribe,speak}`).
 *
 * These routes spend the operator's `Z_AI_*` credits and can spawn ffmpeg, so
 * they must not answer strangers. Two modes, chosen by the `AI_ACCESS_TOKEN`
 * environment variable:
 *
 * 1. Token set — the only mode that actually AUTHENTICATES a caller. Every
 *    request must present the token as `Authorization: Bearer <token>` or
 *    `x-printifier-token: <token>`; it is compared timing-safely and anything
 *    else gets 401.
 *
 * 2. Token unset (default) — the route is still not open to strangers: a
 *    request is accepted only when it is same-origin, i.e. its `Origin`
 *    header (and, when the browser sends one, its `Sec-Fetch-Site` hint)
 *    matches the host the request arrived on. The per-minute instance budget
 *    in `lib/rate-limit.ts` stays in force in both modes.
 *
 * TRADE-OFF, stated plainly: same-origin is NOT authentication. Any script
 * can forge `Origin` and `Sec-Fetch-Site`, and any visitor who can load the
 * app itself is by definition same-origin with it — so mode 2 only stops
 * cross-site/embedded abuse and naive scanners, and the budget remains the
 * thing that bounds spend. Setting `AI_ACCESS_TOKEN` is the only way to keep
 * strangers out. Deployments that leave it unset are choosing "rate-limited
 * public" over "authenticated".
 *
 * The bundled UI has no settings field for a token, so it is unaffected by
 * mode 2 (same-origin) and needs no client change. Operators who set a token
 * either drive the API from their own client or have their reverse proxy
 * attach the header to `/api/ai/*`.
 *
 * Embedding note: if an operator widens `FRAME_ANCESTORS` so the app is
 * framed by another origin, the framer's page is NOT same-origin with the
 * iframe, so mode 2 refuses its AI calls. That deployment must set
 * `AI_ACCESS_TOKEN` (the proxy can attach it) - embedding and mode 2 are
 * mutually exclusive by construction.
 */

export const AI_TOKEN_HEADER = 'x-printifier-token'

export const AI_TOKEN_ENV = 'AI_ACCESS_TOKEN'

/** The configured operator token, or null when the feature is in same-origin mode. */
export function aiAccessToken(): string | null {
  const raw = process.env[AI_TOKEN_ENV]
  if (typeof raw !== 'string') return null
  const token = raw.trim()
  return token.length > 0 ? token : null
}

/** Constant-time string compare that does not leak length either. */
function tokensMatch(presented: string, expected: string): boolean {
  // Hash both sides to a fixed size so timingSafeEqual never throws on
  // differing lengths and the comparison time does not depend on the input.
  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** Pull the token out of either supported header. */
function presentedToken(request: Request): string | null {
  const auth = request.headers.get('authorization')
  if (auth) {
    const match = /^Bearer[ \t]+(\S.*)$/i.exec(auth.trim())
    if (match) return match[1].trim()
  }
  const header = request.headers.get(AI_TOKEN_HEADER)
  if (header && header.trim().length > 0) return header.trim()
  return null
}

/**
 * Origin the request was delivered on.
 *
 * The `Host` header the client actually addressed is used first: the dev
 * server (and some standalone deployments) report `request.url` with the
 * bound address rather than the requested one, so a browser that opened
 * `127.0.0.1:3000` or a LAN address would otherwise be judged cross-origin
 * against its own page and lose the AI features. Comparing Origin with Host is
 * the same-origin rule; it is not authentication (see the header comment).
 *
 * `x-forwarded-host` is consulted only when the operator vouches for the proxy
 * chain with TRUST_PROXY=1 - the same rule the rate limiter applies.
 */
function requestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url)
    if (process.env.TRUST_PROXY === '1') {
      const forwardedHost = request.headers.get('x-forwarded-host')
      if (forwardedHost && forwardedHost.trim().length > 0) {
        const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
        const proto = forwardedProto && forwardedProto.length > 0 ? forwardedProto : url.protocol.replace(':', '')
        return new URL(`${proto}://${forwardedHost.split(',')[0].trim()}`).origin
      }
    }
    const host = request.headers.get('host')
    if (host && host.trim().length > 0) {
      return new URL(`${url.protocol}//${host.trim()}`).origin
    }
    return url.origin
  } catch {
    return null
  }
}

function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/** True when the browser says (and the Origin header agrees) this is our own page. */
function isSameOrigin(request: Request): boolean {
  const expected = requestOrigin(request)
  if (!expected) return false

  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false

  const origin = request.headers.get('origin')
  if (origin) {
    const actual = normalizeOrigin(origin)
    return actual !== null && actual === expected
  }

  // No Origin: only a browser fetch hint can vouch for the request. Anything
  // else (curl, a server-side script) has no same-origin evidence at all.
  return site === 'same-origin' || site === 'none'
}

function deny(status: number, error: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers })
}

/**
 * Returns a 401/403 response when the request may not use the AI routes, or
 * null when it may proceed. Call this first, before parsing the body or
 * touching the SDK.
 */
export function requireAiAccess(request: Request): NextResponse | null {
  const token = aiAccessToken()

  if (token) {
    const presented = presentedToken(request)
    if (!presented || !tokensMatch(presented, token)) {
      return deny(401, 'AI access token required', {
        'WWW-Authenticate': 'Bearer realm="printifier-ai"',
      })
    }
    return null
  }

  if (!isSameOrigin(request)) {
    return deny(403, 'Cross-origin AI requests are not allowed')
  }
  return null
}
