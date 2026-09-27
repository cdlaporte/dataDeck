// Measurement harness for dense-clump behaviour (used by jitter.test.ts).
import { MOTION, TICK_MS } from './motion';
import { Simulation } from './Simulation';

export interface ClumpMetrics {
  /** RMS per-tick movement of the interior half of each group, after settling (px). */
  jitter: number;
  /** 95th-percentile overlap between touching bubbles, as a fraction of the smaller radius. */
  p95Overlap: number;
}

/** Radius the engine would use for n bubbles in a ~700×600 plot (see encodings.baseRadius). */
export function appRadius(n: number): number {
  return Math.max(2, Math.min(18, Math.sqrt((700 * 600 * 0.16) / (n * Math.PI))));
}

/**
 * Builds n bubbles split into `groups` targets (1 = a single cluster), lets
 * them settle for `settleMs`, then measures jitter and overlap.
 */
export function measureClumps(n: number, groups = 1, settleMs = 6000, sim = new Simulation()): ClumpMetrics {
  const r = appRadius(n) * (groups > 1 ? 0.8 : 1);
  sim.setMotion(MOTION.balanced);
  sim.setCount(n, 0, 0, r * 2);
  const cols = Math.ceil(Math.sqrt(groups));
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const group = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const g = i % groups;
    group[i] = g;
    tx[i] = (g % cols) * 220;
    ty[i] = Math.floor(g / cols) * 220;
  }
  sim.setTargets(tx, ty, groups > 1 ? 0.1 : 0.06, groups > 1 ? 0.1 : 0.06);
  const radii = new Float32Array(n).fill(r + 0.8);
  sim.setCollision(radii, 0.85);
  (sim as { setDensity?: (n: number) => void }).setDensity?.(n);
  sim.reheat(0.6);
  const settleTicks = Math.round(settleMs / TICK_MS);
  for (let t = 0; t < settleTicks; t++) sim.tick();

  // Interior = nodes closer to their target than the group's median distance.
  const dist = sim.nodes.map((d, i) => Math.hypot(d.x - tx[i], d.y - ty[i]));
  const byGroup: number[][] = Array.from({ length: groups }, () => []);
  dist.forEach((d, i) => byGroup[group[i]].push(d));
  const median = byGroup.map((ds) => ds.sort((a, b) => a - b)[ds.length >> 1] ?? 0);
  const interior = sim.nodes.map((_, i) => dist[i] <= median[group[i]]);

  let sum = 0;
  let count = 0;
  for (let t = 0; t < 60; t++) {
    const before = sim.nodes.map((d) => [d.x, d.y]);
    sim.tick();
    sim.nodes.forEach((d, i) => {
      if (!interior[i]) return;
      sum += (d.x - before[i][0]) ** 2 + (d.y - before[i][1]) ** 2;
      count++;
    });
  }
  const jitter = Math.sqrt(sum / Math.max(1, count));

  // Overlaps between neighbouring bubbles (true radius, excluding padding).
  const overlaps: number[] = [];
  const nodes = sim.nodes;
  for (let i = 0; i < n; i++) {
    let worst = 0;
    for (let j = 0; j < n; j++) {
      if (i === j || group[i] !== group[j]) continue;
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < 2 * r) worst = Math.max(worst, (2 * r - d) / r);
    }
    overlaps.push(worst);
  }
  overlaps.sort((a, b) => a - b);
  return { jitter, p95Overlap: overlaps[Math.floor(overlaps.length * 0.95)] };
}
