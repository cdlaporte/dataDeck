import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';

/** Median distance from each node to its nearest neighbour. */
function medianNearest(sim: Simulation) {
  const nodes = sim.nodes;
  const nearest = nodes.map((a, i) => {
    let m = Infinity;
    nodes.forEach((b, j) => {
      if (i !== j) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
    });
    return m;
  });
  nearest.sort((a, b) => a - b);
  return nearest[nearest.length >> 1];
}

describe('grid collision', () => {
  it('packs bubbles pulled to one point without overlap', () => {
    const n = 400;
    const sim = new Simulation();
    sim.setCount(n, 0, 0, 1);
    sim.setTargets(new Float32Array(n), new Float32Array(n), 0.1, 0.1);
    sim.setCollision(new Float32Array(n).fill(5), 1);
    sim.reheat(1);
    for (let i = 0; i < 300; i++) sim.tick();
    // Like d3.forceCollide, a constant inward pull compresses the core slightly.
    expect(medianNearest(sim)).toBeGreaterThan(8.2);
  });

  it('ignores hidden (radius 0) nodes', () => {
    const n = 50;
    const sim = new Simulation();
    sim.setCount(n, 0, 0, 0.1);
    sim.setTargets(new Float32Array(n), new Float32Array(n), 0.1, 0.1);
    sim.setCollision(new Float32Array(n), 1);
    sim.reheat(1);
    for (let i = 0; i < 100; i++) sim.tick();
    const spread = Math.max(...sim.nodes.map((d) => Math.hypot(d.x, d.y)));
    expect(spread).toBeLessThan(1);
  });

  it('keeps a 5,000-row beeswarm tick cheap', () => {
    const n = 5000;
    const sim = new Simulation();
    sim.setCount(n, 500, 350, 3);
    sim.setTargets(
      new Float32Array(n).map(() => 100 + Math.random() * 800),
      new Float32Array(n).fill(350),
      0.6,
      0.03,
    );
    sim.setCollision(new Float32Array(n).fill(3), 1);
    sim.reheat(0.9);
    for (let i = 0; i < 30; i++) sim.tick();
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) sim.tick();
    const ms = (performance.now() - t0) / 60;
    console.log(`grid collide @5k: ${ms.toFixed(2)} ms/tick`);
    expect(ms).toBeLessThan(12);
  });
});
