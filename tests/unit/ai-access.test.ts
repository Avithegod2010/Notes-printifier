/**
 * ai-access.test.ts — the gate in front of the paid /api/ai routes.
 *
 * Covers both modes required by the audit (H1):
 *  - AI_ACCESS_TOKEN set: Bearer / x-printifier-token, timing-safe compare,
 *    401 for missing or wrong tokens, and the token does not care about
 *    Origin (a real caller with the token may come from anywhere);
 *  - AI_ACCESS_TOKEN unset: same-origin only, cross-origin 403, and a request
 *    with no Origin/Sec-Fetch-Site evidence (curl) refused.
 *
 * The last block drives the REAL route handlers, so the gate is proven to be
 * wired into doctor / transcribe / speak and to run before body parsing.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AI_TOKEN_ENV, aiAccessToken, requireAiAccess } from '../../src/lib/ai-access'

// Imported statically so a wiring test never awaits between setting the token
// and calling the handler (the env is process-global).
import { POST as doctorPost } from '../../src/app/api/ai/doctor/route'
import { POST as transcribePost } from '../../src/app/api/ai/transcribe/route'
import { POST as speakPost } from '../../src/app/api/ai/speak/route'

const ORIGIN = 'https://printifier.test'

const ORIGINAL_TOKEN = process.env.AI_ACCESS_TOKEN

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.AI_ACCESS_TOKEN
  else process.env.AI_ACCESS_TOKEN = ORIGINAL_TOKEN
})

function req(path = '/api/ai/doctor', headers: Record<string, string> = {}, body?: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body })
}

function setToken(token: string | undefined) {
  if (token === undefined) delete process.env.AI_ACCESS_TOKEN
  else process.env[AI_TOKEN_ENV] = token
}

describe('token mode (AI_ACCESS_TOKEN set)', () => {
  it('accepts the token as Authorization: Bearer', () => {
    setToken('s3cret-operator-token')
    assert.equal(requireAiAccess(req('/api/ai/doctor', { authorization: 'Bearer s3cret-operator-token' })), null)
  })

  it('accepts the token as x-printifier-token', () => {
    setToken('s3cret-operator-token')
    assert.equal(requireAiAccess(req('/api/ai/transcribe', { 'x-printifier-token': 's3cret-operator-token' })), null)
  })

  it('accepts a lowercase bearer scheme', () => {
    setToken('s3cret-operator-token')
    assert.equal(requireAiAccess(req('/api/ai/speak', { authorization: 'bearer s3cret-operator-token' })), null)
  })

  it('401s a wrong token even when the request is same-origin', () => {
    setToken('s3cret-operator-token')
    const res = requireAiAccess(
      req('/api/ai/doctor', { origin: ORIGIN, 'sec-fetch-site': 'same-origin', authorization: 'Bearer nope' }),
    )
    assert.equal(res?.status, 401)
  })

  it('401s a token that is only a prefix of the real one (length is not leaked as a match)', () => {
    setToken('s3cret-operator-token')
    const res = requireAiAccess(req('/api/ai/doctor', { 'x-printifier-token': 's3cret-operator-toke' }))
    assert.equal(res?.status, 401)
  })

  it('401s a missing token and advertises the scheme', async () => {
    setToken('s3cret-operator-token')
    const res = requireAiAccess(req('/api/ai/doctor', { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }))
    assert.equal(res?.status, 401)
    assert.match(res?.headers.get('www-authenticate') ?? '', /^Bearer /)
    const body = (await res!.json()) as { ok: boolean; error: string }
    assert.equal(body.ok, false)
    assert.ok(body.error.length > 0)
  })

  it('ignores a non-Bearer Authorization value', () => {
    setToken('s3cret-operator-token')
    const res = requireAiAccess(req('/api/ai/doctor', { authorization: 'Basic s3cret-operator-token' }))
    assert.equal(res?.status, 401)
  })

  it('does not depend on Origin when the token matches', () => {
    setToken('s3cret-operator-token')
    assert.equal(
      requireAiAccess(req('/api/ai/doctor', { origin: 'https://elsewhere.test', 'x-printifier-token': 's3cret-operator-token' })),
      null,
    )
  })

  it('treats a blank environment value as unset (falls back to same-origin)', () => {
    setToken('   ')
    assert.equal(aiAccessToken(), null)
    assert.equal(requireAiAccess(req('/api/ai/doctor', { origin: ORIGIN, 'sec-fetch-site': 'same-origin' })), null)
    assert.equal(requireAiAccess(req('/api/ai/doctor'))?.status, 403)
  })

  it('trims surrounding whitespace on the configured token', () => {
    setToken('  padded-token  ')
    assert.equal(requireAiAccess(req('/api/ai/doctor', { authorization: 'Bearer padded-token' })), null)
  })
})

describe('same-origin mode (AI_ACCESS_TOKEN unset)', () => {
  it('accepts an Origin that matches the request host', () => {
    setToken(undefined)
    assert.equal(requireAiAccess(req('/api/ai/doctor', { origin: ORIGIN, 'sec-fetch-site': 'same-origin' })), null)
  })

  it('accepts a same-origin browser hint when Origin is absent', () => {
    setToken(undefined)
    assert.equal(requireAiAccess(req('/api/ai/speak', { 'sec-fetch-site': 'same-origin' })), null)
  })

  it('403s a cross-origin Origin', () => {
    setToken(undefined)
    const res = requireAiAccess(req('/api/ai/doctor', { origin: 'https://attacker.test' }))
    assert.equal(res?.status, 403)
  })

  it('403s a different port on the same host', () => {
    setToken(undefined)
    const res = requireAiAccess(req('/api/ai/doctor', { origin: 'https://printifier.test:8443' }))
    assert.equal(res?.status, 403)
  })

  it('403s a downgraded scheme (http instead of https)', () => {
    setToken(undefined)
    const res = requireAiAccess(req('/api/ai/doctor', { origin: 'http://printifier.test' }))
    assert.equal(res?.status, 403)
  })

  it('403s a matching Origin that contradicts Sec-Fetch-Site: cross-site', () => {
    setToken(undefined)
    const res = requireAiAccess(
      req('/api/ai/doctor', { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }),
    )
    assert.equal(res?.status, 403)
  })

  it('403s a same-site (sibling subdomain) request', () => {
    setToken(undefined)
    const res = requireAiAccess(
      req('/api/ai/doctor', { origin: 'https://api.printifier.test', 'sec-fetch-site': 'same-site' }),
    )
    assert.equal(res?.status, 403)
  })

  it('403s a request with no Origin and no browser hint (curl / scripts)', () => {
    setToken(undefined)
    const res = requireAiAccess(req('/api/ai/doctor'))
    assert.equal(res?.status, 403)
  })

  it('403s the literal Origin: null', () => {
    setToken(undefined)
    const res = requireAiAccess(req('/api/ai/doctor', { origin: 'null' }))
    assert.equal(res?.status, 403)
  })
})

describe('same-origin mode follows the Host the browser addressed', () => {
  // The dev server (and some standalone deployments) put the bind address in
  // request.url, so a page opened at 127.0.0.1 or a LAN address was judged
  // cross-origin against itself and lost the AI features. Origin is compared
  // with the Host header the client actually sent.
  function hostedReq(path: string, host: string, headers: Record<string, string> = {}): Request {
    // request.url deliberately names a different host than the browser used.
    return new Request(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: { host, ...headers },
    })
  }

  it('accepts a LAN host when Origin matches it', () => {
    setToken(undefined)
    const res = requireAiAccess(
      hostedReq('/api/ai/doctor', '192.168.29.120:3111', {
        origin: 'http://192.168.29.120:3111',
        'sec-fetch-site': 'same-origin',
      }),
    )
    assert.equal(res, null)
  })

  it('accepts loopback when the page was opened at 127.0.0.1', () => {
    setToken(undefined)
    assert.equal(
      requireAiAccess(
        hostedReq('/api/ai/doctor', '127.0.0.1:3111', {
          origin: 'http://127.0.0.1:3111',
          'sec-fetch-site': 'same-origin',
        }),
      ),
      null,
    )
  })

  it('still refuses an Origin that does not match the Host', () => {
    setToken(undefined)
    const res = requireAiAccess(
      hostedReq('/api/ai/doctor', '192.168.29.120:3111', { origin: 'http://192.168.29.121:3111' }),
    )
    assert.equal(res?.status, 403)
  })

  it('refuses an unparseable Host instead of guessing', () => {
    setToken(undefined)
    const res = requireAiAccess(hostedReq('/api/ai/doctor', 'bad host/with space', { origin: ORIGIN }))
    assert.equal(res?.status, 403)
  })
})

describe('wiring: the real route handlers refuse before parsing the body', () => {
  const routes: Array<[string, (request: Request) => Promise<Response>]> = [
    ['doctor', doctorPost],
    ['transcribe', transcribePost],
    ['speak', speakPost],
  ]

  for (const [name, post] of routes) {
    it(`POST /api/ai/${name} returns 401 without the token when AI_ACCESS_TOKEN is set`, async () => {
      setToken('s3cret-operator-token')
      const res = await post(req(`/api/ai/${name}`, { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }))
      assert.equal(res.status, 401)
    })

    it(`POST /api/ai/${name} lets a token-bearing request through the gate`, async () => {
      setToken('s3cret-operator-token')
      // An array body is rejected by each handler's own validation — a 400
      // (not 401) proves the request passed the gate and never reached the SDK.
      const res = await post(
        req(
          `/api/ai/${name}`,
          { authorization: 'Bearer s3cret-operator-token', 'content-type': 'application/json' },
          '[]',
        ),
      )
      assert.equal(res.status, 400)
    })

    it(`POST /api/ai/${name} returns 403 for a cross-origin caller when no token is configured`, async () => {
      setToken(undefined)
      const res = await post(req(`/api/ai/${name}`, { origin: 'https://attacker.test' }))
      assert.equal(res.status, 403)
    })
  }
})
