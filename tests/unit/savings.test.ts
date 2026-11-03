/**
 * savings.test.ts — paper/ink money math + Indian rupee formatting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COST,
  costProfileIsDefault,
  estimateSavings,
  formatRupees,
} from '../../src/lib/savings';

describe('estimateSavings', () => {
  it('counts sheets saved as input − output, never negative', () => {
    assert.equal(estimateSavings({ inputPages: 41, outputPages: 14, inkSavedPct: 30 }).sheetsSaved, 27);
    assert.equal(estimateSavings({ inputPages: 10, outputPages: 4, inkSavedPct: 30 }).sheetsSaved, 6);
    // output larger than input (rare, e.g. booklet padding) clamps to 0
    assert.equal(estimateSavings({ inputPages: 2, outputPages: 5, inkSavedPct: 0 }).sheetsSaved, 0);
  });

  it('scales paper cost by sheets and ink cost by coverage saved', () => {
    const noInk = estimateSavings(
      { inputPages: 10, outputPages: 5, inkSavedPct: 0 },
      { ...DEFAULT_COST, paperRsPerSheet: 1, inkRsPerFullPage: 1 },
    );
    assert.equal(noInk.rupees, 5); // paper only

    const halfInk = estimateSavings(
      { inputPages: 10, outputPages: 5, inkSavedPct: 50, beforeInkPct: 100 },
      { ...DEFAULT_COST, paperRsPerSheet: 1, inkRsPerFullPage: 1 },
    );
    // ink: 10 pages × 100% coverage × ₹1 × 50% saved = ₹5 → total 10
    assert.equal(halfInk.rupees, 10);
  });

  it('clamps ink percentages into 0..100', () => {
    const e = estimateSavings(
      { inputPages: 10, outputPages: 10, inkSavedPct: 500, beforeInkPct: -20 },
      { ...DEFAULT_COST, paperRsPerSheet: 1, inkRsPerFullPage: 1 },
    );
    // beforeInk −20 → 0 → no ink cost at all
    assert.equal(e.rupees, 0);
  });

  it('never returns negative rupees', () => {
    assert.equal(estimateSavings({ inputPages: 0, outputPages: 0, inkSavedPct: 0 }).rupees >= 0, true);
  });
});

describe('formatRupees', () => {
  it('formats with the Indian grouping', () => {
    assert.equal(formatRupees(70), '₹70');
    assert.equal(formatRupees(12345), '₹12,345');
    assert.equal(formatRupees(1234567), '₹12,34,567');
  });

  it('rounds fractions', () => {
    assert.equal(formatRupees(9.6), '₹10');
  });
});

describe('costProfileIsDefault', () => {
  it('matches the shipped defaults', () => {
    assert.equal(costProfileIsDefault(DEFAULT_COST), true);
    assert.equal(costProfileIsDefault({ ...DEFAULT_COST, paperRsPerSheet: 2 }), false);
  });
});
