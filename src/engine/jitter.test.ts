import { describe, expect, it } from 'vitest';
import { measureClumps, measureStragglers } from './jitterHarness';

// Before position-based collisions + dead-zone pull, a 5,000-bubble clump
// measured 0.80 px/tick of interior jitter and a 102% p95 overlap.
describe('dense clumps settle without jitter or overlap', () => {
  for (const n of [300, 1000, 3000, 5000]) {
    it(`single cluster of ${n}`, () => {
      const m = measureClumps(n, 1);
      expect(m.jitter).toBeLessThan(0.02);
      expect(m.p95Overlap).toBeLessThan(0.1);
    }, 60000);
  }

  it('12 groups of 250', () => {
    const m = measureClumps(3000, 12);
    expect(m.jitter).toBeLessThan(0.05);
    expect(m.p95Overlap).toBeLessThan(0.1);
  }, 60000);
});

describe('bubbles reach their destination', () => {
  // Before the arrival-aware hold: 2.7% (3,000) and 4.6% (5,000) of bubbles were
  // still far from their group 4 s after a cluster → 12 groups transition.
  for (const n of [1000, 3000, 5000]) {
    it(`${n} bubbles regroup within 4 s`, () => {
      expect(measureStragglers(n, 12, 4000)).toBeLessThan(0.02);
    }, 60000);
  }
});
