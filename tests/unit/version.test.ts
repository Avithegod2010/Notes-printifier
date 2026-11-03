/**
 * version.test.ts — isNewerVersion comparison semantics (update banner).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion } from '../../src/lib/version';

describe('isNewerVersion', () => {
  it('detects a newer remote', () => {
    assert.equal(isNewerVersion('2.5.0', '2.4.0'), true);
    assert.equal(isNewerVersion('2.4.1', '2.4.0'), true);
    assert.equal(isNewerVersion('3.0.0', '2.9.9'), true);
  });

  it('rejects same or older versions', () => {
    assert.equal(isNewerVersion('2.4.0', '2.4.0'), false);
    assert.equal(isNewerVersion('2.3.9', '2.4.0'), false);
    assert.equal(isNewerVersion('1.0.0', '2.4.0'), false);
  });

  it('pads short versions', () => {
    assert.equal(isNewerVersion('2.5', '2.4.0'), true);
    assert.equal(isNewerVersion('2', '1.9.9'), true);
    assert.equal(isNewerVersion('2.3', '2.4.0'), false);
  });

  it('bare numbers beat suffixes at the same version', () => {
    assert.equal(isNewerVersion('2.4.0', '2.4.0-beta'), true);
    assert.equal(isNewerVersion('2.4.0-beta', '2.4.0'), false);
    assert.equal(isNewerVersion('2.4.0-stable', '2.4.0-beta'), true);
  });

  it('treats garbage as zero-filled, never crashing', () => {
    assert.equal(isNewerVersion('x', '2.4.0'), false);
    assert.equal(isNewerVersion('2.4.0', 'x'), true);
  });
});
