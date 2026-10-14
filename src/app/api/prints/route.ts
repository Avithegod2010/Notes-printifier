import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_COUNT = 1_000_000_000
const MAX_INK_SAVED_PCT = 100
const MAX_FILE_NAME_LENGTH = 300
const MAX_ENUM_LENGTH = 50

interface PrintJobInput {
  fileName: string
  inputPages: number
  outputPages: number
  inputBytes: number
  outputBytes: number
  inkSavedPct: number
  colorMode: string
  layout: string
}

type ParseResult = { ok: true; data: PrintJobInput } | { ok: false; error: string }

function isCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_COUNT
  )
}

function isInkSavedPct(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_INK_SAVED_PCT
  )
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function parsePrintJob(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }

  const record = body as Record<string, unknown>

  const fileName = record.fileName
  if (!isNonEmptyString(fileName, MAX_FILE_NAME_LENGTH)) {
    return {
      ok: false,
      error: `fileName must be a non-empty string of at most ${MAX_FILE_NAME_LENGTH} characters`,
    }
  }

  const inputPages = record.inputPages
  if (!isCount(inputPages)) {
    return {
      ok: false,
      error: `inputPages must be an integer between 0 and ${MAX_COUNT}`,
    }
  }

  const outputPages = record.outputPages
  if (!isCount(outputPages)) {
    return {
      ok: false,
      error: `outputPages must be an integer between 0 and ${MAX_COUNT}`,
    }
  }

  const inputBytes = record.inputBytes
  if (!isCount(inputBytes)) {
    return {
      ok: false,
      error: `inputBytes must be an integer between 0 and ${MAX_COUNT}`,
    }
  }

  const outputBytes = record.outputBytes
  if (!isCount(outputBytes)) {
    return {
      ok: false,
      error: `outputBytes must be an integer between 0 and ${MAX_COUNT}`,
    }
  }

  // Optional: percentage of ink saved (0..100). Absent/null defaults to 0.
  let inkSavedPct = 0
  if (
    record.inkSavedPct !== undefined &&
    record.inkSavedPct !== null
  ) {
    if (!isInkSavedPct(record.inkSavedPct)) {
      return {
        ok: false,
        error: `inkSavedPct must be an integer between 0 and ${MAX_INK_SAVED_PCT}`,
      }
    }
    inkSavedPct = record.inkSavedPct
  }

  const colorMode = record.colorMode
  if (!isNonEmptyString(colorMode, MAX_ENUM_LENGTH)) {
    return {
      ok: false,
      error: `colorMode must be a non-empty string of at most ${MAX_ENUM_LENGTH} characters`,
    }
  }

  const layout = record.layout
  if (!isNonEmptyString(layout, MAX_ENUM_LENGTH)) {
    return {
      ok: false,
      error: `layout must be a non-empty string of at most ${MAX_ENUM_LENGTH} characters`,
    }
  }

  return {
    ok: true,
    data: {
      fileName,
      inputPages,
      outputPages,
      inputBytes,
      outputBytes,
      inkSavedPct,
      colorMode,
      layout,
    },
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  const parsed = parsePrintJob(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    await db.printJob.create({ data: parsed.data })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const aggregate = await db.printJob.aggregate({
      _count: { id: true },
      _sum: { inputPages: true, outputPages: true },
      _avg: { inkSavedPct: true },
    })

    const avgRaw = aggregate._avg.inkSavedPct
    const avgInkSavedPct =
      typeof avgRaw === 'number' && Number.isFinite(avgRaw)
        ? Math.min(MAX_INK_SAVED_PCT, Math.max(0, Math.round(avgRaw)))
        : 0

    return NextResponse.json({
      totalFiles: aggregate._count.id,
      totalInputPages: aggregate._sum.inputPages ?? 0,
      totalOutputPages: aggregate._sum.outputPages ?? 0,
      avgInkSavedPct,
    })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}
