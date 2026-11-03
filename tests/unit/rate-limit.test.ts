/**
 * rate-limit.test.ts — fixed-window quotas + client identity semantics
 * (item 3): forwarded headers must be IGNORED unless TRUST_PROXY=1, and
 * un-proxied callers must NOT share one bucket.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clientKey, rateLimit } from '../../src/lib/rate-limit';

function req(headers: Record<string, string>): Request {
  return new Request('https://x.test/api', { headers });
}

describe('rateLimit windows', () => {
  beforeEach(() => {
    // each test gets a fresh key namespace via unique keys
  });

  it('allows up to max, then blocks inside the window', () => {
    const key = `t1:${Math.random()}`;
    assert.equal(rateLimit(key, 3, 60_000), true);
    assert.equal(rateLimit(key, 3, 60_000), true);
    assert.equal(rateLimit(key, 3, 60_000), true);
    assert.equal(rateLimit(key, 3, 60_000), false);
    assert.equal(rateLimit(key, 3, 60_000), false);
  });

  it('resets after the window elapses', () => {
    const key = `t2:${Math.random()}`;
    assert.equal(rateLimit(key, 1, 5), true);
    assert.equal(rateLimit(key, 1, 5), false);
    // bun/node timers: wait out the tiny window
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(rateLimit(key, 1, 5), true);
        resolve();
      }, 10);
    });
  });

  it('buckets are independent', () => {
    const a = `t3:a:${Math.random()}`;
    const b = `t3:b:${Math.random()}`;
    assert.equal(rateLimit(a, 1, 60_000), true);
    assert.equal(rateLimit(a, 1, 60_000), false);
    assert.equal(rateLimit(b, 1, 60_000), true); // unaffected by a
  });
});

describe('clientKey identity (spoof resistance)', () => {
  const ORIGINAL = process.env.TRUST_PROXY;

  it('IGNORES a client-supplied x-forwarded-for without TRUST_PROXY', () => {
    delete process.env.TRUST_PROXY;
    const spoof = clientKey(req({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'ua-A' }));
    const spoof2 = clientKey(req({ 'x-forwarded-for': '5.6.7.8', 'user-agent': 'ua-A' }));
    // different (fake) forwarded IPs must NOT create different buckets
    assert.equal(spoof, spoof2);
    assert.ok(!spoof.startsWith('ip:'), 'must not adopt the spoofed header as identity');
  });

  it('does not collapse distinct users into one unknown bucket', () => {
    delete process.env.TRUST_PROXY;
    const a = clientKey(req({ 'user-agent': 'Mozilla/5.0 Alice' }));
    const b = clientKey(req({ 'user-agent': 'Mozilla/5.0 Bob' }));
    assert.notEqual(a, b);
    assert.notEqual(a, 'unknown');
  });

  it('honors x-forwarded-for only when TRUST_PROXY=1', () => {
    process.env.TRUST_PROXY = '1';
    try {
      const k = clientKey(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'ua' }));
      assert.equal(k, 'ip:203.0.113.9'); // first hop, proxy-vouched
      const r = clientKey(req({ 'x-real-ip': '203.0.113.10', 'user-agent': 'ua' }));
      assert.equal(r, 'ip:203.0.113.10');
    } finally {
      if (ORIGINAL === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = ORIGINAL;
    }
  });

  it('handles a missing user agent without crashing', () => {
    delete process.env.TRUST_PROXY;
    const k = clientKey(req({}));
    assert.ok(k.length > 0);
  });
});
