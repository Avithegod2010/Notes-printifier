/**
 * ssrf-guard.test.ts — negative tests for every IP-encoding trick (item 4)
 * plus the positive cases, with DNS injected so nothing touches the network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveValidatedHop, validateHopUrl } from '../../src/lib/ssrf-guard';

function url(s: string): URL {
  return new URL(s);
}

/** Canned DNS: maps names to addresses; anything else fails to resolve. */
function lookupWith(map: Record<string, Array<{ address: string; family: number }>>) {
  return async (host: string) => {
    const hit = map[host];
    if (!hit) throw new Error('ENOTFOUND');
    return hit;
  };
}

describe('blocked: IP-literal tricks (must never resolve to fetchable)', () => {
  const cases: Array<[string, string]> = [
    // IPv4-mapped IPv6 — dotted-quad AND expanded hex spellings
    ['::ffff:127.0.0.1', 'mapped loopback (dotted)'],
    ['::ffff:7f00:1', 'mapped loopback (hex)'],
    ['[::ffff:10.0.0.1]', 'mapped private, bracketed'],
    ['0:0:0:0:0:ffff:7f00:1', 'mapped loopback, fully expanded hex'],
    ['::0.0.0.0', 'IPv4-compatible unspecified'],
    // classic IPv4 encodings
    ['2130706433', 'decimal 127.0.0.1'],
    ['0x7f000001', 'hex 127.0.0.1'],
    ['0x7f.0.0.1', 'mixed-hex octets'],
    ['0177.0.0.1', 'octal octets'],
    ['127.0.0.1', 'dotted loopback'],
    ['10.0.0.1', 'private class A'],
    ['172.16.0.1', 'private class B'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this-network'],
    ['192.0.0.9', 'IETF protocol assignments 192.0.0.0/24'],
    ['198.18.0.1', 'benchmarking 198.18/15'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved 240/4'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['203.0.113.9', 'TEST-NET-3'],
    // IPv6 ranges
    ['::1', 'IPv6 loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local fd'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation range'],
  ];

  for (const [host, label] of cases) {
    it(`blocks ${host} (${label})`, async () => {
      // IPv6 literals must be bracketed in URLs (the WHATWG parser rejects
      // bare colons — same rule the real route faces).
      const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      const u = url(`http://${hostPart}/file.pdf`);
      const res = await resolveValidatedHop(u);
      assert.equal(res.ok, false, `${host} must be rejected`);
    });
  }
});

describe('blocked: scheme / credential / name tricks', () => {
  it('blocks non-http(s) schemes', async () => {
    assert.notEqual(await validateHopUrl(url('file:///etc/passwd')), null);
    assert.notEqual(await validateHopUrl(url('ftp://example.com/x')), null);
    assert.notEqual(await validateHopUrl(url('gopher://example.com/')), null);
  });

  it('blocks embedded credentials', async () => {
    assert.notEqual(await validateHopUrl(url('http://user:pass@example.com/x')), null);
  });

  it('blocks .local / .internal / .localhost names', async () => {
    assert.notEqual(await validateHopUrl(url('http://myhost.local/x')), null);
    assert.notEqual(await validateHopUrl(url('http://db.internal/x')), null);
    assert.notEqual(await validateHopUrl(url('http://web.localhost/x')), null);
  });

  it('blocks unresolvable names', async () => {
    const res = await resolveValidatedHop(url('http://no-such-host.invalid/x'));
    assert.equal(res.ok, false);
  });

  it('blocks a DNS name that resolves to ANY private address', async () => {
    const res = await resolveValidatedHop(
      url('http://rebinding.test/x'),
      lookupWith({
        'rebinding.test': [
          { address: '93.184.216.34', family: 4 },
          { address: '192.168.0.5', family: 4 }, // one bad answer poisons all
        ],
      }),
    );
    assert.equal(res.ok, false);
  });
});

describe('allowed: genuinely public hosts', () => {
  it('allows public dotted quads and names that resolve public', async () => {
    assert.equal((await resolveValidatedHop(url('http://8.8.8.8/x'))).ok, true);
    assert.equal((await resolveValidatedHop(url('http://1.1.1.1/x'))).ok, true);

    const res = await resolveValidatedHop(
      url('http://example.com/x'),
      lookupWith({ 'example.com': [{ address: '93.184.216.34', family: 4 }] }),
    );
    assert.equal(res.ok, true);
    if (res.ok) {
      // the validated IP is PINNED — the caller dials exactly this address
      assert.equal(res.ip.ip, '93.184.216.34');
      assert.equal(res.ip.family, 4);
    }
  });

  it('pins the first public address for dual-answer hosts', async () => {
    const res = await resolveValidatedHop(
      url('http://dual.test/x'),
      lookupWith({
        'dual.test': [
          { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
          { address: '93.184.216.34', family: 4 },
        ],
      }),
    );
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.ip.family, 6);
  });
});
