import { describe, expect, it } from 'vitest';
import { measureClumps } from './jitterHarness';

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
