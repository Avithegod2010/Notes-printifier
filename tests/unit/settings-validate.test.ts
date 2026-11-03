/**
 * settings-validate.test.ts — the whitelist-and-clamp sanitizer used at every
 * trust boundary (QR links, shared presets, backups, cloud API write+read).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilters,
  sanitizeFiltersPatch,
  sanitizeLayout,
  sanitizeLayoutPatch,
} from '../../src/lib/settings-validate';
import { defaultFilters } from '../../src/lib/pdf/filters';
import { defaultLayout } from '../../src/lib/pdf/layout-settings';

describe('sanitizeFiltersPatch', () => {
  it('keeps valid known keys', () => {
    const p = sanitizeFiltersPatch({ colorMode: 'bw', inkSaver: 55, cleanStains: true });
    assert.deepEqual(p, { colorMode: 'bw', inkSaver: 55, cleanStains: true });
  });

  it('drops unknown keys entirely', () => {
    const p = sanitizeFiltersPatch({ evil: true, __proto__: {}, colorMode: 'auto' });
    assert.deepEqual(p, { colorMode: 'auto' });
  });

  it('clamps number ranges', () => {
    assert.equal(sanitizeFiltersPatch({ inkSaver: 250 }).inkSaver, 100);
    assert.equal(sanitizeFiltersPatch({ inkSaver: -10 }).inkSaver, 0);
    assert.equal(sanitizeFiltersPatch({ headerTrim: 99 }).headerTrim, 25);
    assert.equal(sanitizeFiltersPatch({ penBoost: 1.7 }).penBoost, 2);
  });

  it('rejects wrong types (no string-for-number, no number-for-boolean)', () => {
    assert.equal(sanitizeFiltersPatch({ inkSaver: 'max' }).inkSaver, undefined);
    assert.equal(sanitizeFiltersPatch({ cleanStains: 1 }).cleanStains, undefined);
    assert.equal(sanitizeFiltersPatch({ colorMode: 'rainbow' }).colorMode, undefined);
  });

  it('ignores non-object input', () => {
    assert.deepEqual(sanitizeFiltersPatch(null), {});
    assert.deepEqual(sanitizeFiltersPatch('x'), {});
    assert.deepEqual(sanitizeFiltersPatch([1, 2]), {});
    assert.deepEqual(sanitizeFiltersPatch(42), {});
  });
});

describe('sanitizeLayoutPatch', () => {
  it('clamps the render-critical ranges', () => {
    const p = sanitizeLayoutPatch({ rows: 9999, cols: 0, customDpi: 100000, sheetMargin: -5 });
    assert.equal(p.rows, 8);
    assert.equal(p.cols, 1);
    assert.equal(p.customDpi, 300);
    assert.equal(p.sheetMargin, 0);
  });

  it('validates enums', () => {
    assert.equal(sanitizeLayoutPatch({ pageSize: 'a5' }).pageSize, 'a5');
    assert.equal(sanitizeLayoutPatch({ pageSize: 'banner' }).pageSize, undefined);
    assert.equal(sanitizeLayoutPatch({ quality: 'ultra' }).quality, undefined);
    assert.equal(sanitizeLayoutPatch({ orientation: 'diagonal' }).orientation, undefined);
  });

  it('clamps calibration to 0..12mm per edge', () => {
    const p = sanitizeLayoutPatch({ calib: { t: 3, r: 99, b: -2, l: 1.5 } });
    assert.deepEqual(p.calib, { t: 3, r: 12, b: 0, l: 1.5 });
  });

  it('clamps custom page sizes to 10..1200mm', () => {
    const p = sanitizeLayoutPatch({ customPageW: 99999, customPageH: 2 });
    assert.equal(p.customPageW, 1200);
    assert.equal(p.customPageH, 10);
  });

  it('truncates string fields and strips control characters', () => {
    const p = sanitizeLayoutPatch({
      nameStamp: `Roll ${'n'.repeat(200)}\nline2`,
      docTitle: 'T'.repeat(300),
    });
    assert.ok(p.nameStamp!.length <= 80);
    assert.ok(!p.nameStamp!.includes('\n'));
    assert.ok(p.docTitle!.length <= 80);
  });
});

describe('sanitizeFilters / sanitizeLayout (full objects)', () => {
  it('fill missing keys with factory defaults', () => {
    const f = sanitizeFilters({ colorMode: 'invert' });
    assert.equal(f.colorMode, 'invert');
    assert.equal(f.inkSaver, defaultFilters.inkSaver);
    assert.equal(f.cleanStains, defaultFilters.cleanStains);

    const l = sanitizeLayout({ rows: 1 });
    assert.equal(l.rows, 1);
    assert.equal(l.cols, defaultLayout.cols);
    assert.equal(l.pageSize, defaultLayout.pageSize);
  });

  it('defaults survive a completely hostile payload', () => {
    const l = sanitizeLayout({
      rows: { $gt: '' },
      cols: () => 'boom',
      customDpi: Number.NaN,
      pageSize: ['a4'],
      toString: 'evil',
    });
    assert.deepEqual(l, defaultLayout);
  });
});
