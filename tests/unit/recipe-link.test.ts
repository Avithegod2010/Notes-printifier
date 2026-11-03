/**
 * recipe-link.test.ts — QR recipe encode/decode round-trips AND the hostile
 * payload cases: decodeRecipe must whitelist keys AND clamp values (item 5),
 * because ?r= links are fully attacker-controlled.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRecipe, encodeRecipe } from '../../src/lib/recipe-link';
import { defaultFilters } from '../../src/lib/pdf/filters';
import { defaultLayout } from '../../src/lib/pdf/layout-settings';

function b64url(json: unknown): string {
  return Buffer.from(JSON.stringify(json), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('encodeRecipe / decodeRecipe round trip', () => {
  it('preserves non-default settings through a QR code', () => {
    const filters = { ...defaultFilters, colorMode: 'invert' as const, inkSaver: 42 };
    const layout = { ...defaultLayout, rows: 2, cols: 2, booklet: true };
    const code = encodeRecipe(filters, layout);
    assert.ok(code, 'encode should succeed');
    const back = decodeRecipe(code!);
    assert.ok(back);
    assert.equal(back!.filters.colorMode, 'invert');
    assert.equal(back!.filters.inkSaver, 42);
    assert.equal(back!.layout.rows, 2);
    assert.equal(back!.layout.cols, 2);
    assert.equal(back!.layout.booklet, true);
  });

  it('returns null for garbage input', () => {
    assert.equal(decodeRecipe('not-base64!!'), null);
    assert.equal(decodeRecipe(Buffer.from('{"v":2}').toString('base64url')), null); // wrong version
    assert.equal(decodeRecipe(''), null);
  });

  it('drops unknown keys (forward compat without blind trust)', () => {
    const code = b64url({
      v: 1,
      f: { colorMode: 'bw', __protoHack: 'evil', bogus: 1 },
      l: { rows: 2, nope: true },
    });
    const back = decodeRecipe(code);
    assert.ok(back);
    assert.deepEqual(Object.keys(back!.filters).sort(), ['colorMode']);
    assert.deepEqual(Object.keys(back!.layout).sort(), ['rows']);
  });
});

describe('decodeRecipe hardening (crafted ?r= links)', () => {
  it('clamps rows/cols to sane ranges', () => {
    const back = decodeRecipe(
      b64url({ v: 1, f: {}, l: { rows: 9999, cols: -5 } }),
    );
    assert.ok(back);
    assert.ok(back!.layout.rows! >= 1 && back!.layout.rows! <= 8, 'rows clamped into 1..8');
    assert.ok(back!.layout.cols! >= 1 && back!.layout.cols! <= 4, 'cols clamped into 1..4');
  });

  it('clamps customDpi to 72..300 and accepts explicit null', () => {
    const huge = decodeRecipe(b64url({ v: 1, f: {}, l: { customDpi: 100000 } }));
    assert.ok(huge);
    assert.ok(huge!.layout.customDpi! <= 300);

    const off = decodeRecipe(b64url({ v: 1, f: {}, l: { customDpi: null } }));
    assert.ok(off);
    assert.equal(off!.layout.customDpi, null);
  });

  it('rejects non-numeric rows instead of propagating NaN', () => {
    const back = decodeRecipe(b64url({ v: 1, f: {}, l: { rows: 'lots' } }));
    assert.ok(back);
    assert.equal(back!.layout.rows, undefined);
  });

  it('rejects an invalid colorMode instead of passing it through', () => {
    const back = decodeRecipe(b64url({ v: 1, f: { colorMode: 'rainbow' }, l: {} }));
    assert.ok(back);
    assert.equal(back!.filters.colorMode, undefined);
  });

  it('clamps inkSaver and rejects strings for numbers', () => {
    const back = decodeRecipe(
      b64url({ v: 1, f: { inkSaver: 4000 }, l: {} }),
    );
    assert.ok(back);
    assert.equal(back!.filters.inkSaver, 100);

    const bad = decodeRecipe(b64url({ v: 1, f: { inkSaver: 'max' }, l: {} }));
    assert.ok(bad);
    assert.equal(bad!.filters.inkSaver, undefined);
  });

  it('bounds logoRegions to a small array of 0..1 boxes', () => {
    const evil = decodeRecipe(
      b64url({ v: 1, f: { logoRegions: [{ x: 5, y: 5, w: 5, h: 5 }, 'x', 42] }, l: {} }),
    );
    assert.ok(evil);
    assert.equal(evil!.filters.logoRegions, undefined); // malformed → dropped

    const ok = decodeRecipe(
      b64url({ v: 1, f: { logoRegions: [{ x: 0.1, y: 0.1, w: 0.8, h: 0.2 }] }, l: {} }),
    );
    assert.ok(ok);
    assert.equal(ok!.filters.logoRegions?.length, 1);
  });

  it('truncates oversized string fields (name stamp / footer)', () => {
    const back = decodeRecipe(
      b64url({ v: 1, f: {}, l: { nameStamp: 'A'.repeat(500), footerLabel: 'B'.repeat(500) } }),
    );
    assert.ok(back);
    assert.ok(back!.layout.nameStamp!.length <= 80);
    assert.ok(back!.layout.footerLabel!.length <= 80);
  });
});
