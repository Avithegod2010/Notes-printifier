import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { clientKey, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/doctor — "AI Print Doctor".
 * Asks an LLM for concrete print-setting tweaks for one document, sanitized
 * against strict whitelists. On ANY SDK/parse failure we answer with the same
 * shape from a deterministic heuristic advisor, so the client always gets
 * ok:true + a usable patch. Nothing about the request is ever persisted.
 */

type Lang = 'en' | 'hi'
type Goal = 'balanced' | 'ink' | 'pages' | 'readability'
type ColorMode = 'auto' | 'original' | 'invert' | 'grayscale' | 'bw'
type PageSize = 'a4' | 'letter'
type Orientation = 'portrait' | 'landscape'
type Quality = 'low' | 'medium' | 'high' | 'ultra'

type FiltersPatch = Partial<{
  colorMode: ColorMode
  inkSaver: number
  cleanStains: boolean
  trimMargins: boolean
  penBoost: number
  searchable: boolean
  deskew: boolean
  logoStrip: number
}>

type LayoutPatch = Partial<{
  rows: number
  cols: number
  pageSize: PageSize
  orientation: Orientation
  quality: Quality
  booklet: boolean
  duplexPad: boolean
  slideNumbers: boolean
  noteLines: boolean
  coverSheet: boolean
  sizeTargetMB: number | null
}>

type DoctorReply = {
  title: string
  summary: string
  tips: string[]
  patch: { filters?: FiltersPatch; layout?: LayoutPatch }
}

type DoctorContext = {
  lang: Lang
  goal: Goal
  doc: { name: string; pages: number; bytes: number }
  settings: {
    colorMode: ColorMode
    inkSaver: number
    cleanStains: boolean
    trimMargins: boolean
    penBoost: number
    searchable: boolean
    deskew: boolean
    logoStrip: number
    rows: number
    cols: number
    pageSize: PageSize
    orientation: Orientation
    quality: Quality
    booklet: boolean
    duplexPad: boolean
    slideNumbers: boolean
    noteLines: boolean
    coverSheet: boolean
    sizeTargetMB: number | null
  }
}

const COLOR_MODES: readonly ColorMode[] = ['auto', 'original', 'invert', 'grayscale', 'bw']
const PAGE_SIZES: readonly PageSize[] = ['a4', 'letter']
const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape']
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra']
const GOALS: readonly Goal[] = ['balanced', 'ink', 'pages', 'readability']
const LANGS: readonly Lang[] = ['en', 'hi']

const RATE_MAX = 20
const RATE_WINDOW_MS = 5 * 60 * 1000
// Generous but bounded: an LLM hang must not hold the client's spinner forever.
const AI_TIMEOUT_MS = 15_000

// The SDK skill docs say the backend expects system prompts under the 'assistant' role.
const SYSTEM_PROMPT = `You are "Print Doctor", an expert print-settings advisor for a student PDF print-optimizer tool. You receive one JSON context describing a document (name, pages, bytes), the student's goal, and their current print settings. Recommend the minimal, concrete set of setting changes that best serves the goal: "ink" (save ink), "pages" (save paper), "readability" (easier to read), or "balanced".

Respond with STRICT JSON ONLY — no markdown fences, no prose — exactly this shape:
{"title": string, "summary": string, "tips": string[], "patch": {"filters": {}, "layout": {}}}

Rules:
- title: at most 60 characters. summary: 1-2 short sentences. tips: at most 4 short actionable strings.
- Write title, summary and tips in the requested language.
- patch.filters allowed keys: colorMode ("auto"|"original"|"invert"|"grayscale"|"bw"), inkSaver (number 0-100), cleanStains (boolean), trimMargins (boolean), penBoost (number 0-100), searchable (boolean), deskew (boolean), logoStrip (number 0-25).
- patch.layout allowed keys: rows (integer 1-8), cols (integer 1-4), pageSize ("a4"|"letter"), orientation ("portrait"|"landscape"), quality ("low"|"medium"|"high"|"ultra"), booklet, duplexPad, slideNumbers, noteLines, coverSheet (boolean), sizeTargetMB (number 0-200 or null).
- Include ONLY keys you recommend changing (an empty patch object is valid). Values must be plain JSON numbers/booleans/strings — no units, no strings for numbers, no invented keys.`

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown, fallback: string, max: number): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Coerce an arbitrary request body into a fully-typed context (missing → defaults). */
function parseContext(body: Record<string, unknown>): DoctorContext {
  const doc = isRecord(body.doc) ? body.doc : {}
  const s = isRecord(body.settings) ? body.settings : {}
  const sizeTargetMB =
    s.sizeTargetMB === null
      ? null
      : typeof s.sizeTargetMB === 'number' && Number.isFinite(s.sizeTargetMB)
        ? Math.round(clamp(s.sizeTargetMB, 0, 200))
        : null
  return {
    lang: asEnum(body.lang, LANGS, 'en'),
    goal: asEnum(body.goal, GOALS, 'balanced'),
    doc: {
      name: asString(doc.name, 'document.pdf', 120),
      pages: Math.max(1, Math.round(asNumber(doc.pages, 1))),
      bytes: Math.max(0, Math.round(asNumber(doc.bytes, 0))),
    },
    settings: {
      colorMode: asEnum(s.colorMode, COLOR_MODES, 'original'),
      inkSaver: clamp(asNumber(s.inkSaver, 0), 0, 100),
      cleanStains: asBool(s.cleanStains, false),
      trimMargins: asBool(s.trimMargins, false),
      penBoost: clamp(asNumber(s.penBoost, 0), 0, 100),
      searchable: asBool(s.searchable, false),
      deskew: asBool(s.deskew, false),
      logoStrip: clamp(asNumber(s.logoStrip, 0), 0, 25),
      rows: clamp(Math.round(asNumber(s.rows, 1)), 1, 8),
      cols: clamp(Math.round(asNumber(s.cols, 1)), 1, 4),
      pageSize: asEnum(s.pageSize, PAGE_SIZES, 'a4'),
      orientation: asEnum(s.orientation, ORIENTATIONS, 'portrait'),
      quality: asEnum(s.quality, QUALITIES, 'medium'),
      booklet: asBool(s.booklet, false),
      duplexPad: asBool(s.duplexPad, false),
      slideNumbers: asBool(s.slideNumbers, false),
      noteLines: asBool(s.noteLines, false),
      coverSheet: asBool(s.coverSheet, false),
      sizeTargetMB,
    },
  }
}

/** Whitelist + clamp an LLM patch: unknown keys are dropped, never trusted. */
function sanitizePatch(raw: unknown): DoctorReply['patch'] {
  const out: DoctorReply['patch'] = {}
  if (!isRecord(raw)) return out

  if (isRecord(raw.filters)) {
    const f = raw.filters
    const filters: FiltersPatch = {}
    if (typeof f.colorMode === 'string' && (COLOR_MODES as readonly string[]).includes(f.colorMode)) {
      filters.colorMode = f.colorMode as ColorMode
    }
    if (typeof f.inkSaver === 'number' && Number.isFinite(f.inkSaver)) {
      filters.inkSaver = Math.round(clamp(f.inkSaver, 0, 100))
    }
    if (typeof f.cleanStains === 'boolean') filters.cleanStains = f.cleanStains
    if (typeof f.trimMargins === 'boolean') filters.trimMargins = f.trimMargins
    if (typeof f.penBoost === 'number' && Number.isFinite(f.penBoost)) {
      filters.penBoost = Math.round(clamp(f.penBoost, 0, 100))
    }
    if (typeof f.searchable === 'boolean') filters.searchable = f.searchable
    if (typeof f.deskew === 'boolean') filters.deskew = f.deskew
    if (typeof f.logoStrip === 'number' && Number.isFinite(f.logoStrip)) {
      filters.logoStrip = Math.round(clamp(f.logoStrip, 0, 25))
    }
    if (Object.keys(filters).length > 0) out.filters = filters
  }

  if (isRecord(raw.layout)) {
    const l = raw.layout
    const layout: LayoutPatch = {}
    if (typeof l.rows === 'number' && Number.isFinite(l.rows)) layout.rows = clamp(Math.round(l.rows), 1, 8)
    if (typeof l.cols === 'number' && Number.isFinite(l.cols)) layout.cols = clamp(Math.round(l.cols), 1, 4)
    if (typeof l.pageSize === 'string' && (PAGE_SIZES as readonly string[]).includes(l.pageSize)) {
      layout.pageSize = l.pageSize as PageSize
    }
    if (typeof l.orientation === 'string' && (ORIENTATIONS as readonly string[]).includes(l.orientation)) {
      layout.orientation = l.orientation as Orientation
    }
    if (typeof l.quality === 'string' && (QUALITIES as readonly string[]).includes(l.quality)) {
      layout.quality = l.quality as Quality
    }
    for (const key of ['booklet', 'duplexPad', 'slideNumbers', 'noteLines', 'coverSheet'] as const) {
      if (typeof l[key] === 'boolean') layout[key] = l[key] as boolean
    }
    // sizeTargetMB accepts a clamped number or an explicit null (meaning "unset")
    if (l.sizeTargetMB === null) {
      layout.sizeTargetMB = null
    } else if (typeof l.sizeTargetMB === 'number' && Number.isFinite(l.sizeTargetMB)) {
      layout.sizeTargetMB = Math.round(clamp(l.sizeTargetMB, 0, 200))
    }
    if (Object.keys(layout).length > 0) out.layout = layout
  }

  return out
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** Tolerant JSON extraction: strips markdown fences, grabs first { … last }. */
function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found in completion')
  return JSON.parse(unfenced.slice(start, end + 1))
}

async function aiAdvice(ctx: DoctorContext): Promise<DoctorReply> {
  const zai = await ZAI.create()
  const completion = (await withTimeout(
    zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Print job context:\n${JSON.stringify({ lang: ctx.lang, goal: ctx.goal, doc: ctx.doc, settings: ctx.settings })}\n\nReply with STRICT JSON only, written in ${ctx.lang === 'hi' ? 'Hindi (Devanagari script)' : 'English'}.`,
        },
      ],
      thinking: { type: 'disabled' },
    }),
    AI_TIMEOUT_MS,
  )) as { choices?: Array<{ message?: { content?: unknown } }> }

  const content = completion.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('empty completion')

  const parsed: unknown = extractJson(content)
  if (!isRecord(parsed)) throw new Error('completion JSON is not an object')

  const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 60) : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 400) : ''
  if (!title || !summary) throw new Error('completion missing title/summary')

  const tips = Array.isArray(parsed.tips)
    ? parsed.tips
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 160))
        .slice(0, 4)
    : []

  return { title, summary, tips, patch: sanitizePatch(parsed.patch) }
}

type Copy = {
  titles: Record<Goal, string>
  summary: (pages: number, hint: string) => string
  tipInvert: string
  tipBw: string
  tipUp: string
  tipTrim: string
  tipPen: string
  tipDeskew: string
  tipFewer: string
  hintDark: string
  hintHand: string
  hintGoal: string
}

const COPY: Record<Lang, Copy> = {
  en: {
    titles: {
      balanced: 'Balanced print plan',
      ink: 'Ink-saving print plan',
      pages: 'Paper-saving print plan',
      readability: 'Readability-first plan',
    },
    summary: (pages, hint) => `Tuned for a ${pages}-page document. ${hint}`,
    tipInvert: 'Dark slides detected — invert colors to save ink.',
    tipBw: 'Black & white mode cuts ink on text-heavy pages.',
    tipUp: 'More slides per sheet means fewer printed pages.',
    tipTrim: 'Trim margins so content fills the page.',
    tipPen: 'Pen boost restores faint handwriting.',
    tipDeskew: 'Deskew straightens scanned or photographed pages.',
    tipFewer: 'Fewer pages per sheet keeps text easy to read.',
    hintDark: 'Dark slide deck: inverted colors and a tighter grid save the most ink.',
    hintHand: 'Handwritten/scanned look: pen boost and deskew will help most.',
    hintGoal: 'Settings are nudged toward your selected goal.',
  },
  hi: {
    titles: {
      balanced: 'संतुलित प्रिंट योजना',
      ink: 'स्याही बचत योजना',
      pages: 'कागज़ बचत योजना',
      readability: 'स्पष्टता-केंद्रित योजना',
    },
    summary: (pages, hint) => `${pages} पेज के दस्तावेज़ के लिए सेटिंग। ${hint}`,
    tipInvert: 'गहरे स्लाइड मिले — स्याही बचाने के लिए रंग उलटें।',
    tipBw: 'टेक्स्ट वाले पेजों पर काला-सफ़ेद मोड स्याही बचाता है।',
    tipUp: 'एक शीट पर ज़्यादा स्लाइड = कम प्रिंट पेज।',
    tipTrim: 'कंटेंट बड़ा करने के लिए मार्जिन काटें।',
    tipPen: 'फीकी लिखावट के लिए पेन बूस्ट चालू करें।',
    tipDeskew: 'स्कैन/फ़ोटो पेजों को सीधा करने के लिए डीस्क्यू चालू करें।',
    tipFewer: 'पढ़ने में आसानी के लिए शीट पर कम पेज रखें।',
    hintDark: 'गहरा स्लाइड डेक: रंग उलटना और कसी लेआउट से सबसे ज़्यादा स्याही बचेगी।',
    hintHand: 'हैंडरिटन/स्कैन जैसा लगा: पेन बूस्ट और डीस्क्यू सबसे काम आएंगे।',
    hintGoal: 'सेटिंग को आपके चुने लक्ष्य की ओर झुकाया गया है।',
  },
}

/** Deterministic offline advisor — mirrors the LLM's job when the SDK is down. */
function heuristicAdvice(ctx: DoctorContext): DoctorReply {
  const C = COPY[ctx.lang]
  const name = ctx.doc.name.toLowerCase()
  // Filename heuristics: Indian-edtech slide decks ("pw", "physics") are dark & ink-hungry.
  const darkDeck = /(pw|slide|physics|ppt|deck|dark)/.test(name) && ctx.doc.pages >= 20
  const handwritten = /(note|scan|handwrit|written)/.test(name)

  const filters: FiltersPatch = {}
  const layout: LayoutPatch = {}
  const tips: string[] = []

  // 1) goal-level tuning first
  if (ctx.goal === 'ink') {
    filters.colorMode = 'bw'
    filters.inkSaver = 60
    tips.push(C.tipBw)
  } else if (ctx.goal === 'pages') {
    // grow the grid toward a larger rows*cols product
    layout.rows = clamp(Math.max(ctx.settings.rows, 4), 1, 8)
    layout.cols = clamp(Math.max(ctx.settings.cols, 2), 1, 4)
    tips.push(C.tipUp)
  } else if (ctx.goal === 'readability') {
    layout.rows = Math.min(ctx.settings.rows, 2)
    layout.cols = 1
    layout.quality = 'high'
    tips.push(C.tipFewer)
  }

  // 2) content hints layer on top (more specific wins)
  if (darkDeck) {
    filters.colorMode = 'invert'
    filters.inkSaver = Math.max(filters.inkSaver ?? 0, 50)
    filters.trimMargins = true
    // land in the 4–6 slides-per-sheet range
    if ((layout.rows ?? ctx.settings.rows) * (layout.cols ?? ctx.settings.cols) < 4) {
      layout.rows = clamp(Math.max(layout.rows ?? ctx.settings.rows, 3), 1, 8)
      layout.cols = clamp(Math.max(layout.cols ?? ctx.settings.cols, 2), 1, 4)
    }
    tips.unshift(C.tipInvert)
  }
  if (handwritten) {
    filters.penBoost = Math.max(filters.penBoost ?? 0, 40)
    filters.deskew = true
    filters.colorMode = filters.colorMode ?? 'original'
    tips.unshift(C.tipPen, C.tipDeskew)
  }

  // 3) balanced-goal garnish: big file with no size target → suggest compression
  if (ctx.goal === 'balanced' && ctx.doc.bytes > 20_000_000 && ctx.settings.sizeTargetMB === null) {
    layout.sizeTargetMB = 10
    tips.push(C.tipTrim)
  }

  const hint = darkDeck ? C.hintDark : handwritten ? C.hintHand : C.hintGoal
  return {
    title: C.titles[ctx.goal],
    summary: C.summary(ctx.doc.pages, hint),
    tips: Array.from(new Set(tips)).slice(0, 4),
    patch: {
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(Object.keys(layout).length > 0 ? { layout } : {}),
    },
  }
}

export async function POST(request: Request) {
  // Light IP rate limit before doing any parsing/LLM work.
  if (!rateLimit(`doctor:${clientKey(request)}`, RATE_MAX, RATE_WINDOW_MS)) {
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

  const ctx = parseContext(body)

  try {
    const reply = await aiAdvice(ctx)
    return NextResponse.json({ ok: true, source: 'ai', ...reply })
  } catch (err) {
    // Never surface an error to the user: degrade to the deterministic advisor.
    console.error('doctor: falling back to heuristic —', err instanceof Error ? err.message : err)
    const reply = heuristicAdvice(ctx)
    return NextResponse.json({ ok: true, source: 'heuristic', ...reply })
  }
}
