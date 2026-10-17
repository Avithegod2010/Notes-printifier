import { NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import ZAI from 'z-ai-web-dev-sdk'
import { clientKey, rateLimit } from '../_rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/speak — spoken receipt (TTS).
 * Returns the raw audio binary (not base64/JSON) so the client can feed it
 * straight into an <audio> element / blob URL. MP3 is requested first; if the
 * upstream rejects that format we synthesize WAV and transcode to real MP3
 * via ffmpeg, falling back to serving WAV with its true Content-Type.
 */

const RATE_MAX = 20
const RATE_WINDOW_MS = 5 * 60 * 1000
const MAX_CHARS = 1000 // SDK hard limit is 1024; we keep headroom
const MIN_SPEED = 0.5
const MAX_SPEED = 2

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Clamp long text at the last sentence boundary before MAX_CHARS so the spoken
 * receipt never ends mid-sentence. Hindi danda '।' counts as a sentence end.
 */
function clampToSentences(text: string): string {
  if (text.length <= MAX_CHARS) return text
  const slice = text.slice(0, MAX_CHARS)
  for (let i = slice.length - 1; i >= 0; i--) {
    const ch = slice[i]
    if (ch === '.' || ch === '!' || ch === '?' || ch === '।') {
      return slice.slice(0, i + 1).trim()
    }
  }
  return slice // no sentence boundary found — hard cut
}

/** One TTS synthesis round-trip; resolves with the raw audio bytes. */
async function synthesize(input: string, speed: number, format: 'mp3' | 'wav'): Promise<Buffer> {
  const zai = await ZAI.create()
  const res = await zai.audio.tts.create({
    input,
    voice: 'tongtong',
    speed,
    response_format: format,
    stream: false,
  })
  return Buffer.from(new Uint8Array(await res.arrayBuffer()))
}

/** Transcode WAV → MP3 with ffmpeg, fully piped (no temp files). */
function wavToMp3(wav: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0', // WAV in from stdin
      '-codec:a', 'libmp3lame',
      '-b:a', '96k', // speech receipt — low bitrate is plenty
      '-f', 'mp3',
      'pipe:1', // MP3 out to stdout
    ])
    const chunks: Buffer[] = []
    ff.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    ff.on('error', reject) // e.g. ffmpeg not installed
    ff.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited with ${code}`)),
    )
    ff.stdin.on('error', reject)
    ff.stdin.end(wav)
  })
}

export async function POST(request: Request) {
  if (!rateLimit(`speak:${clientKey(request)}`, RATE_MAX, RATE_WINDOW_MS)) {
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
  if (!isRecord(body) || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'text is required (1-1000 chars)' }, { status: 400 })
  }

  // Clamp instead of rejecting — the receipt text is generated client-side and
  // only rarely exceeds the limit; the SDK errors on out-of-range speeds.
  const clampedText = clampToSentences(body.text.trim())
  const speed =
    typeof body.speed === 'number' && Number.isFinite(body.speed)
      ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, body.speed))
      : 1

  try {
    let audio: Buffer
    let contentType: string
    try {
      audio = await synthesize(clampedText, speed, 'mp3')
      contentType = 'audio/mpeg'
    } catch (mp3Err) {
      // Upstream currently rejects response_format:'mp3' (error 1214). Fall back
      // to WAV and transcode so clients still get a broadly playable format.
      console.error('speak: mp3 unavailable, trying wav —', mp3Err instanceof Error ? mp3Err.message : mp3Err)
      const wav = await synthesize(clampedText, speed, 'wav')
      try {
        audio = await wavToMp3(wav)
        contentType = 'audio/mpeg'
      } catch (transcodeErr) {
        console.error('speak: wav→mp3 transcode unavailable —', transcodeErr instanceof Error ? transcodeErr.message : transcodeErr)
        audio = wav
        contentType = 'audio/wav'
      }
    }
    return new NextResponse(audio, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('speak failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'Speech generation failed' }, { status: 500 })
  }
}
