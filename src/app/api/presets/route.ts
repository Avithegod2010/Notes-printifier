import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientKey, rateLimit } from '@/lib/rate-limit'
import { sanitizeFilters, sanitizeLayout } from '@/lib/settings-validate'
import { presetCutoff, shouldPrune } from '@/lib/preset-share-ttl'

export const dynamic = 'force-dynamic'

/**
 * POST /api/presets — create a shareable preset link (F2).
 * Body: { name, filters, layout } → { id } (short url-safe id).
 * Only the recipe is stored — never any document content.
 *
 * filters/layout are whitelist-sanitized BEFORE storage (unknown keys
 * dropped, every value type-checked and clamped) — the API is a trust
 * boundary, not a JSON bucket; anything that survives the length check
 * still cannot poison the render pipeline of whoever opens the link.
 */
const MAX_NAME = 60

function shortId(): string {
  // unambiguous alphabet so links survive handwriting/reading
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const CREATE_RATE_MAX = 20
const RATE_WINDOW_MS = 5 * 60 * 1000

export async function POST(request: Request) {
  if (!rateLimit(`presets:create:${clientKey(request)}`, CREATE_RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests, try again in a few minutes' },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 })
  }
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: 'Body must be an object' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!name) {
    return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 })
  }
  if (!isRecord(body.filters) || !isRecord(body.layout)) {
    return NextResponse.json(
      { ok: false, error: 'filters and layout objects are required' },
      { status: 400 },
    )
  }

  // Validate on WRITE: store full, sanitized settings objects. What comes
  // back out of the database later is therefore safe by construction too.
  const data = JSON.stringify({
    filters: sanitizeFilters(body.filters),
    layout: sanitizeLayout(body.layout),
  })

  try {
    // hygiene: drop shares older than 30 days — opportunistic, throttled
    if (shouldPrune()) {
      void db.presetShare
        .deleteMany({ where: { createdAt: { lt: presetCutoff() } } })
        .catch(() => undefined)
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const id = shortId()
      const exists = await db.presetShare.findUnique({ where: { id } })
      if (exists) continue
      await db.presetShare.create({ data: { id, name, data } })
      return NextResponse.json({ ok: true, id }, { status: 201 })
    }
    return NextResponse.json({ ok: false, error: 'Could not allocate an id' }, { status: 500 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const count = await db.presetShare.count()
    return NextResponse.json({ ok: true, count })
  } catch {
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
