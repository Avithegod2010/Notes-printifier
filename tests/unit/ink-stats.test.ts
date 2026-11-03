/**
 * ink-stats.test.ts — pure helpers: streaks across weeks, milestones,
 * tree/CO₂ conversions. (localStorage-backed loaders are exercised via the
 * API/backup tests; the pure math is what matters here.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, co2GramsFor, milestoneFor, treesFor } from '../../src/lib/ink-stats';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const now = Date.now();

describe('computeStreak', () => {
  it('counts this week\'s jobs', () => {
    const s = computeStreak([now - 1000, now - 2000, now - 3000]);
    assert.equal(s.weekCount, 3);
    assert.equal(s.totalJobs, 3);
    assert.equal(s.streakWeeks, 1);
  });

  it('extends the streak across consecutive weeks', () => {
    const s = computeStreak([now, now - WEEK, now - 2 * WEEK, now - 3 * WEEK]);
    assert.equal(s.streakWeeks, 4);
  });

  it('keeps a streak alive from last week (grace) but does not extend', () => {
    const s = computeStreak([now - WEEK, now - 2 * WEEK]);
    assert.equal(s.streakWeeks, 2);
    assert.equal(s.weekCount, 0);
  });

  it('breaks the streak after a gap week', () => {
    const s = computeStreak([now, now - 2 * WEEK]);
    assert.equal(s.streakWeeks, 1);
  });

  it('sums sheets for the current week from the sheets map', () => {
    // distinct timestamps — a real Map can't hold the same key twice
    const a = now;
    const b = now - 1000;
    const s = computeStreak([a, b], new Map([[a, 5], [b, 7]]));
    assert.equal(s.weekCount, 2);
    assert.equal(s.weekSheets, 12);
  });

  it('handles an empty log', () => {
    const s = computeStreak([]);
    assert.equal(s.weekCount, 0);
    assert.equal(s.streakWeeks, 0);
    assert.equal(s.totalJobs, 0);
  });
});

describe('milestoneFor', () => {
  it('returns null tier below Bronze', () => {
    const m = milestoneFor(0);
    assert.equal(m.tierKey, null);
    assert.equal(m.nextKey, 'im.tier.bronze');
    assert.equal(m.sheetsToNext, 10);
  });

  it('progresses through tiers', () => {
    assert.equal(milestoneFor(10).tierKey, 'im.tier.bronze');
    assert.equal(milestoneFor(50).tierKey, 'im.tier.silver');
    assert.equal(milestoneFor(1000).tierKey, 'im.tier.legend');
    const legend = milestoneFor(5000);
    assert.equal(legend.nextKey, null);
    assert.equal(legend.sheetsToNext, 0);
    assert.equal(legend.progressPct, 100);
  });

  it('computes progress toward the next tier', () => {
    const m = milestoneFor(30); // between Bronze (10) and Silver (50)
    assert.equal(m.tierKey, 'im.tier.bronze');
    assert.equal(m.nextKey, 'im.tier.silver');
    assert.equal(m.sheetsToNext, 20);
    assert.equal(m.progressPct, Math.round(((30 - 10) / (50 - 10)) * 100));
  });
});

describe('conversions', () => {
  it('tree count is a 2-decimal estimate (~8,333 sheets/tree)', () => {
    assert.equal(treesFor(0), 0);
    assert.equal(treesFor(1), 0);
    assert.equal(treesFor(8333), 1);
    // display-rounded: 8332 sheets already round to one tree at 2 decimals
    assert.equal(treesFor(8332), 1);
    assert.equal(treesFor(16666), 2);
  });

  it('CO₂ uses 5 g per sheet', () => {
    assert.equal(co2GramsFor(1), 5);
    assert.equal(co2GramsFor(27), 135);
  });
});
