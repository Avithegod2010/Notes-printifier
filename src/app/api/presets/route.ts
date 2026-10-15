import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/presets — create a shareable preset link (F2).
 * Body: { name, filters, layout } → { id } (short url-safe id).
 * Only the recipe is stored — never any document content.
 */
const MAX_NAME = 60
const MAX_DATA = 20_000 // filters+layout JSON is ~1–2 KB; 20 KB is generous

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

export async function POST(request: Request) {
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

  const data = JSON.stringify({ filters: body.filters, layout: body.layout })
  if (data.length > MAX_DATA) {
    return NextResponse.json({ ok: false, error: 'Preset too large' }, { status: 413 })
  }

  try {
    // hygiene: drop shares older than 30 days on every write
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    void db.presetShare
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch(() => undefined)

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
