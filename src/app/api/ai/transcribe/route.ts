import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { clientKey, rateLimit } from '../_rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/transcribe — speech-to-text for voice commands (ASR).
 * Accepts { audio: base64, mime? }. The audio is only forwarded to the ASR
 * service and the recognized text returned — nothing is ever persisted.
 * `mime` is accepted for future-proofing but the ASR endpoint has no mime field.
 */

const RATE_MAX = 30
const RATE_WINDOW_MS = 5 * 60 * 1000
const MAX_DECODED_BYTES = 10 * 1024 * 1024
// Base64 charset; whitespace tolerated because recorders sometimes wrap lines.
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function POST(request: Request) {
  if (!rateLimit(`transcribe:${clientKey(request)}`, RATE_MAX, RATE_WINDOW_MS)) {
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
  if (!isRecord(body) || typeof body.audio !== 'string' || body.audio.trim() === '') {
    return NextResponse.json({ ok: false, error: 'audio (base64 string) is required' }, { status: 400 })
  }

  // Tolerate data-URL prefixes like "data:audio/webm;base64,XXXX".
  const raw = body.audio.trim()
  const audioBase64 = raw.startsWith('data:') && raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw

  if (!BASE64_RE.test(audioBase64)) {
    return NextResponse.json({ ok: false, error: 'audio must be valid base64' }, { status: 400 })
  }

  // Decode once to enforce the size ceiling before touching the SDK.
  const decoded = Buffer.from(audioBase64, 'base64')
  if (decoded.length === 0) {
    return NextResponse.json({ ok: false, error: 'audio is empty' }, { status: 400 })
  }
  if (decoded.length > MAX_DECODED_BYTES) {
    return NextResponse.json({ ok: false, error: 'audio too large (max 10 MB)' }, { status: 413 })
  }

  try {
    const zai = await ZAI.create()
    const res = await zai.audio.asr.create({ file_base64: audioBase64 })
    const text = (res as { text?: string }).text ?? ''
    // Empty text is a valid outcome (silence/noise) — still ok:true.
    return NextResponse.json({ ok: true, text })
  } catch (err) {
    console.error('transcribe failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Transcription failed' }, { status: 500 })
  }
}
