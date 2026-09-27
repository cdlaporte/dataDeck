import type { SimNode } from './Simulation';

/**
 * Collision on a uniform grid (cell = largest diameter), replacing
 * d3.forceCollide's quadtree for dense layouts of thousands of bubbles.
 * Overlaps of predicted positions (x + vx) are resolved by moving positions
 * directly (position-based dynamics) rather than adding velocity, so contacts
 * add no bounce energy and dense clumps rest instead of jittering. The push is
 * split by squared radius so small bubbles yield to large ones.
 * Nodes with radius 0 (hidden) are ignored entirely.
 */
export class GridCollide {
  private order = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private cellStart = new Int32Array(0);
  private px = new Float64Array(0);
  private py = new Float64Array(0);

  apply(nodes: SimNode[], radii: Float32Array, strength: number, iterations = 2) {
    const n = nodes.length;
    if (n === 0 || strength <= 0) return;
    if (this.order.length < n) {
      this.order = new Int32Array(n);
      this.cellOf = new Int32Array(n);
      this.px = new Float64Array(n);
      this.py = new Float64Array(n);
    }
    for (let it = 0; it < iterations; it++) this.pass(nodes, radii, strength);
  }

  private pass(nodes: SimNode[], radii: Float32Array, strength: number) {
    const n = nodes.length;
    const { px, py, cellOf, order } = this;

    // Predicted positions and bounds of active nodes.
    let maxR = 0;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const r = radii[i];
      if (!(r > 0)) continue;
      const node = nodes[i];
      const x = (px[i] = node.x + node.vx);
      const y = (py[i] = node.y + node.vy);
      if (r > maxR) maxR = r;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (maxR === 0) return;

    // Grid sized to the largest diameter, capped so outliers can't explode memory.
    let cell = maxR * 2;
    let cols = Math.floor((x1 - x0) / cell) + 1;
    let rows = Math.floor((y1 - y0) / cell) + 1;
    const MAX_CELLS = 1 << 18;
    if (cols * rows > MAX_CELLS) {
      const f = Math.sqrt((cols * rows) / MAX_CELLS);
      cell *= f;
      cols = Math.floor((x1 - x0) / cell) + 1;
      rows = Math.floor((y1 - y0) / cell) + 1;
    }
    const cells = cols * rows;
    if (this.cellStart.length < cells + 1)
      this.cellStart = new Int32Array(Math.max(cells + 1, this.cellStart.length * 2));
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);

    // Counting sort of active nodes by cell.
    for (let i = 0; i < n; i++) {
      if (!(radii[i] > 0)) {
        cellOf[i] = -1;
        continue;
      }
      const c = Math.floor((py[i] - y0) / cell) * cols + Math.floor((px[i] - x0) / cell);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells);
    for (let i = 0; i < n; i++) if (cellOf[i] >= 0) order[fill[cellOf[i]]++] = i;

    for (let i = 0; i < n; i++) {
      const ci = cellOf[i];
      if (ci < 0) continue;
      const ri = radii[i];
      const ri2 = ri * ri;
      const cx = ci % cols;
      const cy = (ci - cx) / cols;
      const node = nodes[i];
      // Live predicted position; updated as pushes are applied.
      let xi = node.x + node.vx;
      let yi = node.y + node.vy;
      for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++) {
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++) {
          const c = gy * cols + gx;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const j = order[k];
            if (j <= i) continue; // each pair once
            const rj = radii[j];
            const r = ri + rj;
            const other = nodes[j];
            let x = xi - (other.x + other.vx);
            let y = yi - (other.y + other.vy);
            let l = x * x + y * y;
            if (l >= r * r) continue;
            if (x === 0) {
              x = (Math.random() - 0.5) * 1e-6;
              l += x * x;
            }
            if (y === 0) {
              y = (Math.random() - 0.5) * 1e-6;
              l += y * y;
            }
            l = Math.sqrt(l);
            l = ((r - l) / l) * strength;
            x *= l;
            y *= l;
            const rj2 = rj * rj;
            const w = rj2 / (ri2 + rj2);
            node.x += x * w;
            node.y += y * w;
            xi += x * w;
            yi += y * w;
            other.x -= x * (1 - w);
            other.y -= y * (1 - w);
          }
        }
      }
    }
  }
}
