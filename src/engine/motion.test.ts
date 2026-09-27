import { describe, expect, it } from 'vitest';
import { MOTION, TICK_MS, TickClock } from './motion';
import { Simulation } from './Simulation';

describe('TickClock', () => {
  const ticksIn = (frameMs: number, totalMs: number) => {
    const clock = new TickClock();
    let ticks = 0;
    for (let t = 0; t <= totalMs; t += frameMs) ticks += clock.advance(t);
    return ticks;
  };

  it('runs the same number of ticks at 60 Hz and 120 Hz', () => {
    const at60 = ticksIn(1000 / 60, 2000);
    const at120 = ticksIn(1000 / 120, 2000);
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(1);
    expect(at60).toBeGreaterThanOrEqual(119);
    expect(at60).toBeLessThanOrEqual(122);
  });

  it('does not try to catch up after a stall', () => {
    const clock = new TickClock();
    clock.advance(0);
    expect(clock.advance(5000)).toBe(1);
  });
});

/** A cluster layout: n bubbles all pulled toward one point, starting spread out. */
function cluster(n: number, preset: keyof typeof MOTION) {
  const sim = new Simulation();
  sim.setMotion(MOTION[preset]);
  sim.setCount(n, 0, 0, 12);
  sim.setTargets(new Float32Array(n), new Float32Array(n), 0.06, 0.06);
  sim.setCollision(new Float32Array(n).fill(6), 0.85);
  sim.reheat(0.6);
  return sim;
}

describe('motion', () => {
  for (const preset of ['calm', 'balanced', 'lively'] as const) {
    it(`${preset}: never exceeds the speed limit`, () => {
      const sim = cluster(500, preset);
      const limit = MOTION[preset].maxSpeed + 1e-6;
      for (let t = 0; t < 240; t++) {
        const before = sim.nodes.map((d) => [d.x, d.y]);
        sim.tick();
        for (let i = 0; i < sim.nodes.length; i++) {
          const d = sim.nodes[i];
          expect(Math.hypot(d.x - before[i][0], d.y - before[i][1])).toBeLessThanOrEqual(limit);
        }
      }
    });
  }

  it('settles: grouped bubbles come to rest instead of churning', () => {
    for (const preset of ['calm', 'balanced'] as const) {
      const sim = cluster(800, preset);
      // 8 simulated seconds: bubbles first arrive (arrival hold), then come to rest.
      for (let t = 0; t < Math.round(8000 / TICK_MS); t++) sim.tick();
      const meanSpeed = Math.sqrt(sim.kineticEnergy() / sim.nodes.length);
      expect(meanSpeed).toBeLessThan(0.05);
    }
  });

  it('glides targets instead of jumping', () => {
    const sim = new Simulation();
    sim.setMotion(MOTION.balanced);
    sim.setCount(1, 0, 0, 0);
    sim.setTargets(new Float32Array([1000]), new Float32Array([0]), 0.3, 0.3);
    sim.reheat(0.6);
    expect(sim.transitioning).toBe(true);
    for (let t = 0; t < 10; t++) sim.tick();
    // After 1/6 of a 1 s transition the bubble has moved, but nowhere near the end.
    expect(sim.nodes[0].x).toBeGreaterThan(0);
    expect(sim.nodes[0].x).toBeLessThan(200);
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.transitioning).toBe(false);
    expect(sim.nodes[0].x).toBeGreaterThan(950);
  });
});
