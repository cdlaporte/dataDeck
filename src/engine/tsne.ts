// t-SNE (van der Maaten & Hinton, 2008), following the optimiser used by
// Karpathy's tsne.js (gains, momentum switch, early exaggeration), but with
// sparse k-nearest-neighbour input affinities and exact repulsion computed on
// the fly, so memory stays O(n·k) rather than O(n²) for a few thousand points.

export interface TsneOptions {
  perplexity: number;
  /** Learning rate. */
  epsilon: number;
  seed?: number;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k nearest neighbours by squared Euclidean distance (bounded max-heap per row). */
function knn(data: Float32Array, n: number, d: number, k: number) {
  const idx = new Int32Array(n * k);
  const dist = new Float64Array(n * k);
  const hIdx = new Int32Array(k);
  const hDist = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    let size = 0;
    const oi = i * d;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let s = 0;
      const oj = j * d;
      for (let t = 0; t < d; t++) {
        const diff = data[oi + t] - data[oj + t];
        s += diff * diff;
      }
      if (size < k) {
        // sift up
        let c = size++;
        hIdx[c] = j;
        hDist[c] = s;
        while (c > 0) {
          const p = (c - 1) >> 1;
          if (hDist[p] >= hDist[c]) break;
          [hDist[p], hDist[c]] = [hDist[c], hDist[p]];
          [hIdx[p], hIdx[c]] = [hIdx[c], hIdx[p]];
          c = p;
        }
      } else if (s < hDist[0]) {
        hDist[0] = s;
        hIdx[0] = j;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1;
          const r = l + 1;
          let m = c;
          if (l < k && hDist[l] > hDist[m]) m = l;
          if (r < k && hDist[r] > hDist[m]) m = r;
          if (m === c) break;
          [hDist[m], hDist[c]] = [hDist[c], hDist[m]];
          [hIdx[m], hIdx[c]] = [hIdx[c], hIdx[m]];
          c = m;
        }
      }
    }
    for (let t = 0; t < k; t++) {
      idx[i * k + t] = hIdx[t];
      dist[i * k + t] = hDist[t];
    }
  }
  return { idx, dist };
}

/** Conditional probabilities p(j|i) over each row's neighbours, calibrated to the perplexity. */
function conditionalP(dist: Float64Array, n: number, k: number, perplexity: number): Float64Array {
  const P = new Float64Array(n * k);
  const hTarget = Math.log(Math.min(perplexity, k));
  for (let i = 0; i < n; i++) {
    let beta = 1;
    let lo = -Infinity;
    let hi = Infinity;
    const o = i * k;
    // Normalise distances for numerical stability.
    let dmin = Infinity;
    for (let t = 0; t < k; t++) dmin = Math.min(dmin, dist[o + t]);
    for (let iter = 0; iter < 64; iter++) {
      let sum = 0;
      for (let t = 0; t < k; t++) {
        const p = Math.exp(-(dist[o + t] - dmin) * beta);
        P[o + t] = p;
        sum += p;
      }
      let h = 0;
      for (let t = 0; t < k; t++) {
        const p = sum > 0 ? P[o + t] / sum : 0;
        P[o + t] = p;
        if (p > 1e-12) h -= p * Math.log(p);
      }
      if (Math.abs(h - hTarget) < 1e-5) break;
      if (h > hTarget) {
        lo = beta;
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
      } else {
        hi = beta;
        beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2;
      }
    }
  }
  return P;
}

/** Symmetric joint probabilities in CSR form. */
function jointP(idx: Int32Array, cond: Float64Array, n: number, k: number) {
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < k; t++) {
      const j = idx[i * k + t];
      const p = cond[i * k + t];
      rows[i].set(j, (rows[i].get(j) ?? 0) + p);
      rows[j].set(i, (rows[j].get(i) ?? 0) + p);
    }
  }
  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i] + rows[i].size;
  const col = new Int32Array(rowPtr[n]);
  const val = new Float64Array(rowPtr[n]);
  const norm = 1 / (2 * n);
  for (let i = 0; i < n; i++) {
    let o = rowPtr[i];
    for (const [j, p] of rows[i]) {
      col[o] = j;
      val[o++] = Math.max(p * norm, 1e-100);
    }
  }
  return { rowPtr, col, val };
}

export class TSNE {
  readonly n: number;
  iteration = 0;
  /** Current embedding, [x0, y0, x1, y1, …]. */
  readonly Y: Float64Array;
  private gains: Float64Array;
  private ystep: Float64Array;
  private grad: Float64Array;
  private P: { rowPtr: Int32Array; col: Int32Array; val: Float64Array };
  private epsilon: number;

  constructor(data: Float32Array, n: number, d: number, opts: TsneOptions) {
    this.n = n;
    this.epsilon = opts.epsilon;
    const k = Math.max(1, Math.min(n - 1, Math.floor(3 * opts.perplexity)));
    const { idx, dist } = knn(data, n, d, k);
    this.P = jointP(idx, conditionalP(dist, n, k, opts.perplexity), n, k);
    const rand = rng(opts.seed ?? 1);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
    this.Y = new Float64Array(n * 2).map(() => gauss() * 1e-4);
    this.gains = new Float64Array(n * 2).fill(1);
    this.ystep = new Float64Array(n * 2);
    this.grad = new Float64Array(n * 2);
  }

  /** One gradient-descent iteration. */
  step(): void {
    const { n, Y, grad, gains, ystep } = this;
    const exaggeration = this.iteration < 100 ? 4 : 1;
    const momentum = this.iteration < 250 ? 0.5 : 0.8;
    grad.fill(0);

    // Repulsion (exact): accumulate q² (yi - yj) and Z = Σ q.
    const rep = grad; // reuse buffer, attraction added after scaling
    let Z = 0;
    for (let i = 0; i < n; i++) {
      const xi = Y[i * 2];
      const yi = Y[i * 2 + 1];
      let rx = 0;
      let ry = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = xi - Y[j * 2];
        const dy = yi - Y[j * 2 + 1];
        const q = 1 / (1 + dx * dx + dy * dy);
        Z += 2 * q;
        const q2 = q * q;
        rx += q2 * dx;
        ry += q2 * dy;
        rep[j * 2] -= q2 * dx;
        rep[j * 2 + 1] -= q2 * dy;
      }
      rep[i * 2] += rx;
      rep[i * 2 + 1] += ry;
    }
    const invZ = 1 / Z;
    for (let t = 0; t < n * 2; t++) grad[t] = -rep[t] * invZ;

    // Attraction over the sparse P.
    const { rowPtr, col, val } = this.P;
    for (let i = 0; i < n; i++) {
      const xi = Y[i * 2];
      const yi = Y[i * 2 + 1];
      let ax = 0;
      let ay = 0;
      for (let o = rowPtr[i]; o < rowPtr[i + 1]; o++) {
        const j = col[o];
        const dx = xi - Y[j * 2];
        const dy = yi - Y[j * 2 + 1];
        const q = 1 / (1 + dx * dx + dy * dy);
        const f = exaggeration * val[o] * q;
        ax += f * dx;
        ay += f * dy;
      }
      grad[i * 2] += ax;
      grad[i * 2 + 1] += ay;
    }

    // Gains + momentum update (as in tsne.js), gradient includes the factor 4.
    let mx = 0;
    let my = 0;
    for (let t = 0; t < n * 2; t++) {
      const g = 4 * grad[t];
      const gid = Math.sign(g) === Math.sign(ystep[t]);
      gains[t] = Math.max(gid ? gains[t] * 0.8 : gains[t] + 0.2, 0.01);
      ystep[t] = momentum * ystep[t] - this.epsilon * gains[t] * g;
      Y[t] += ystep[t];
      if (t % 2 === 0) mx += Y[t];
      else my += Y[t];
    }
    // Re-centre.
    mx /= n;
    my /= n;
    for (let i = 0; i < n; i++) {
      Y[i * 2] -= mx;
      Y[i * 2 + 1] -= my;
    }
    this.iteration++;
  }
}

/** Builds the t-SNE input matrix: z-scored numeric fields and one-hot categoricals. */
export function buildTsneInput(
  columns: ({ kind: 'number'; values: Float64Array } | { kind: 'string'; values: (string | null)[] })[],
  rows: number[],
): { data: Float32Array; d: number } {
  const blocks: Float32Array[] = [];
  for (const col of columns) {
    if (col.kind === 'number') {
      let sum = 0;
      let cnt = 0;
      for (const r of rows) {
        const v = col.values[r];
        if (Number.isFinite(v)) {
          sum += v;
          cnt++;
        }
      }
      const mean = cnt ? sum / cnt : 0;
      let ss = 0;
      for (const r of rows) {
        const v = col.values[r];
        if (Number.isFinite(v)) ss += (v - mean) ** 2;
      }
      const sd = Math.sqrt(ss / Math.max(1, cnt - 1)) || 1;
      blocks.push(Float32Array.from(rows, (r) => (Number.isFinite(col.values[r]) ? (col.values[r] - mean) / sd : 0)));
    } else {
      const cats = [...new Set(rows.map((r) => col.values[r] ?? '∅'))];
      if (cats.length > 64) continue;
      // Weight one-hot columns so a categorical field contributes like one unit-variance feature.
      const w = 1 / Math.SQRT2;
      for (const c of cats) blocks.push(Float32Array.from(rows, (r) => ((col.values[r] ?? '∅') === c ? w : 0)));
    }
  }
  const d = blocks.length;
  const data = new Float32Array(rows.length * d);
  for (let i = 0; i < rows.length; i++) for (let t = 0; t < d; t++) data[i * d + t] = blocks[t][i];
  return { data, d };
}
