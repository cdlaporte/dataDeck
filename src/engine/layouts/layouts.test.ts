import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../../data/parse';
import { buildTable } from '../../data/profile';
import { computeLayout } from './index';
import { fitClusters, gridFor, groupRows, logTicks, plotRect } from './common';

const csv = [
  'name,group,value,when',
  'a,x,1.5,2020-01-01',
  'b,x,2.5,2020-06-01',
  'c,y,3.5,2021-01-01',
  'd,y,4.5,2021-06-01',
  'e,z,5.5,',
  'f,z,,2022-01-01',
].join('\n');
const table = buildTable(parseDelimited(csv, 't'));
const n = table.rowCount;
const all = new Uint8Array(n).fill(1);
const viewport = { width: 1000, height: 700 };
const radii = new Float32Array(n).fill(5);
const input = { table, visible: all, viewport, radii };

describe('gridFor', () => {
  it('prefers square-ish cells', () => {
    expect(gridFor(1, 800, 600)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(3, 900, 300)).toEqual({ cols: 3, rows: 1 });
    expect(gridFor(4, 600, 600)).toEqual({ cols: 2, rows: 2 });
  });
});

describe('categorical 1D layout', () => {
  it('places each group at an equally spaced centre', () => {
    const res = computeLayout({ mode: '1d', field: 'group' }, input, null);
    expect(res.groups?.keys).toEqual(['x', 'y', 'z']);
    const centres = [0, 2, 4].map((i) => res.tx[i]);
    expect(centres[1] - centres[0]).toBeCloseTo(centres[2] - centres[1]);
    // Members of one group share a target.
    expect(res.tx[0]).toBe(res.tx[1]);
    expect(res.ty[0]).toBe(res.ty[1]);
    expect(res.xAxis).toBeUndefined();
  });

  it('re-spaces groups when a category is filtered out', () => {
    const visible = Uint8Array.from([1, 1, 0, 0, 1, 1]);
    const res = computeLayout({ mode: '1d', field: 'group' }, { ...input, visible }, null);
    expect(res.groups?.keys).toEqual(['x', 'z']);
    expect(res.groups?.nodeGroup[2]).toBe(-1);
  });

  it('folds the long tail into Other', () => {
    const g = groupRows(table, table.fieldByName.group, all, 2);
    expect(g.keys).toEqual(['x', 'Other']);
    expect(g.counts).toEqual([2, 4]);
  });
});

describe('continuous 1D layout', () => {
  it('maps values monotonically onto the x axis and hides missing rows', () => {
    const res = computeLayout({ mode: '1d', field: 'value' }, input, null);
    const rect = plotRect(viewport, { xAxis: true });
    const xs = [0, 1, 2, 3, 4].map((i) => res.tx[i]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(rect.left);
    expect(Math.max(...xs)).toBeLessThanOrEqual(rect.right);
    expect(res.valid[5]).toBe(0);
    expect(res.message).toMatch(/1 row has no value/);
    expect(res.xAxis?.ticks.length).toBeGreaterThan(1);
  });

  it('uses time ticks for dates', () => {
    const res = computeLayout({ mode: '1d', field: 'when' }, input, null);
    expect(res.xAxis?.ticks.some((t) => /20\d\d/.test(t.label))).toBe(true);
  });
});

describe('2D layout', () => {
  it('puts larger y values higher on screen', () => {
    const res = computeLayout({ mode: '2d', x: 'when', y: 'value' }, input, null);
    expect(res.ty[3]).toBeLessThan(res.ty[0]);
    expect(res.tx[3]).toBeGreaterThan(res.tx[0]);
    expect(res.xAxis?.orient).toBe('bottom');
    expect(res.yAxis?.orient).toBe('left');
  });

  it('builds a strip plot for categorical × quantitative', () => {
    const res = computeLayout({ mode: '2d', x: 'group', y: 'value' }, input, null);
    expect(res.tx[0]).toBe(res.tx[1]);
    expect(res.tx[0]).not.toBe(res.tx[2]);
    expect(res.xAxis?.grid).toBe(false);
  });
});

describe('t-SNE layout', () => {
  it('waits for coordinates, then fits them to the plot', () => {
    expect(
      computeLayout(
        { mode: 'tsne', fields: [], params: { perplexity: 5, epsilon: 10, iterations: 10 } },
        input,
        null,
      ).message,
    ).toMatch(/Computing/);
    const coords = new Float32Array([0, 0, 1, 1, 0, 1, 1, 0, 0.5, 0.5, NaN, NaN]);
    const res = computeLayout(
      { mode: 'tsne', fields: [], params: { perplexity: 5, epsilon: 10, iterations: 10 } },
      input,
      coords,
    );
    expect(res.valid[5]).toBe(0);
    const rect = plotRect(viewport);
    expect(res.tx[4]).toBeCloseTo(rect.cx);
    expect(res.ty[4]).toBeCloseTo(rect.cy);
  });
});

describe('fitClusters', () => {
  it('shrinks radii only when a cluster would overflow', () => {
    const groups = new Int32Array(100).fill(0);
    const r = new Float32Array(100).fill(10);
    expect(fitClusters(groups, r, 1, 10000)).toBe(1);
    const s = fitClusters(groups, r, 1, 50);
    expect(s).toBeLessThan(1);
    expect(
      fitClusters(
        groups,
        r.map((v) => v * s),
        1,
        50,
      ),
    ).toBeCloseTo(1);
  });
});

describe('log scales', () => {
  const logCsv = ['name,gross,score', 'a,0,1', 'b,10,10', 'c,1000,100', 'd,100000,1000', 'e,5,10000'].join(
    '\n',
  );
  const t = buildTable(parseDelimited(logCsv, 'log'));
  const all5 = new Uint8Array(t.rowCount).fill(1);
  const inp = { table: t, visible: all5, viewport, radii: new Float32Array(t.rowCount).fill(4) };

  it('uses a log scale for positive fields: equal ratios get equal spacing', () => {
    const res = computeLayout({ mode: '1d', field: 'score', log: true }, inp, null);
    const xs = [0, 1, 2, 3, 4].map((i) => res.tx[i]);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 0);
    expect(res.xAxis?.title).toBe('score (log)');
    expect(res.xAxis?.ticks.map((tk) => tk.label)).toEqual(['1', '10', '100', '1,000', '10,000']);
  });

  it('falls back to symlog when zeros are present, keeping order', () => {
    const res = computeLayout({ mode: '1d', field: 'gross', log: true }, inp, null);
    const xs = [0, 1, 2, 3].map((i) => res.tx[i]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(res.xAxis?.ticks[0].label).toBe('0');
    // Symlog compresses: 10 → 1,000 and 1,000 → 100,000 get similar spans.
    expect(xs[2] - xs[1]).toBeGreaterThan(0.6 * (xs[3] - xs[2]));
  });

  it('applies per-axis in 2D', () => {
    const res = computeLayout({ mode: '2d', x: 'score', y: 'gross', logX: true }, inp, null);
    expect(res.xAxis?.title).toBe('score (log)');
    expect(res.yAxis?.title).toBe('gross');
  });

  it('generates power-of-ten ticks', () => {
    expect(logTicks(1, 1000, false)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(2, 30, false)).toEqual([2, 5, 10, 20]);
    expect(logTicks(-100, 100, true)).toEqual([-100, -10, -1, 0, 1, 10, 100]);
  });
});
