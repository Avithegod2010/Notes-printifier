import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/presets/[id] — fetch a shared preset (F2).
 * Returns { name, filters, layout } or 404. No auth — the id IS the secret
 * (8 unambiguous chars ≈ 30 bits of entropy, links expire in 30 days).
 */
const ID_RE = /^[A-HJ-NP-Z2-9]{8}$/
// The id is the only secret — throttle lookups so the space can't be walked.
const RATE_MAX = 60
const RATE_WINDOW_MS = 5 * 60 * 1000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!rateLimit(`presets:get:${clientKey(request)}`, RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests, try again in a few minutes' },
      { status: 429 },
    )
  }

  const { id } = await params
  if (!ID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'Bad id' }, { status: 400 })
  }
  try {
    const share = await db.presetShare.findUnique({ where: { id } })
    if (!share) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(share.data)
    } catch {
      return NextResponse.json({ ok: false, error: 'Corrupted preset' }, { status: 500 })
    }
    const rec = (parsed ?? {}) as { filters?: unknown; layout?: unknown }
    if (typeof rec.filters !== 'object' || rec.filters === null ||
        typeof rec.layout !== 'object' || rec.layout === null) {
      return NextResponse.json({ ok: false, error: 'Corrupted preset' }, { status: 500 })
    }
    return NextResponse.json(
      { ok: true, name: share.name, filters: rec.filters, layout: rec.layout },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
