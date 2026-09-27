import { describe, expect, it } from 'vitest';
import { TSNE, buildTsneInput } from './tsne';

describe('t-SNE', () => {
  it('separates well-separated clusters', () => {
    // Three gaussian blobs in 5-D.
    const n = 90;
    const d = 5;
    const data = new Float32Array(n * d);
    let s = 3;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < n; i++) for (let t = 0; t < d; t++) data[i * d + t] = (i % 3) * 10 * (t === i % 3 ? 1 : 0) + rand();
    const tsne = new TSNE(data, n, d, { perplexity: 10, epsilon: 20 });
    for (let i = 0; i < 400; i++) tsne.step();
    expect(tsne.Y.every(Number.isFinite)).toBe(true);

    const centroid = (c: number) => {
      let x = 0, y = 0, k = 0;
      for (let i = c; i < n; i += 3) {
        x += tsne.Y[i * 2];
        y += tsne.Y[i * 2 + 1];
        k++;
      }
      return [x / k, y / k];
    };
    const spread = (c: number) => {
      const [cx, cy] = centroid(c);
      let m = 0;
      for (let i = c; i < n; i += 3) m = Math.max(m, Math.hypot(tsne.Y[i * 2] - cx, tsne.Y[i * 2 + 1] - cy));
      return m;
    };
    const [a, b, c] = [centroid(0), centroid(1), centroid(2)];
    const minGap = Math.min(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(b[0] - c[0], b[1] - c[1]));
    expect(minGap).toBeGreaterThan(Math.max(spread(0), spread(1), spread(2)));
  });

  it('builds z-scored / one-hot input', () => {
    const { data, d } = buildTsneInput(
      [
        { kind: 'number', values: new Float64Array([1, 2, 3, NaN]) },
        { kind: 'string', values: ['a', 'b', 'a', null] },
      ],
      [0, 1, 2, 3],
    );
    expect(d).toBe(4); // 1 numeric + 3 categories (a, b, ∅)
    expect(data[0 * d]).toBeCloseTo(-1);
    expect(data[3 * d]).toBe(0); // missing numeric imputed at mean
    expect(data[0 * d + 1]).toBeCloseTo(Math.SQRT1_2);
  });
});
