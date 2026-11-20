import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../../data/parse';
import { buildTable } from '../../data/profile';
import { computeLayout, referenceAvailable, trendAvailable } from './index';
import { fitClusters, formatR, gridFor, groupRows, linearFit, logTicks, plotRect } from './common';

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

describe('reference lines', () => {
  // Group p: 1.5, 2.5, 9.5 (mean 4.5, median 2.5); group q: 10.5, 20.5 (15.5 either way).
  const refData = parseDelimited(
    [
      'name,team,score,other',
      'a,p,1.5,0.25',
      'b,p,2.5,1.75',
      'c,p,9.5,2.25',
      'd,q,10.5,3.75',
      'e,q,20.5,5.25',
    ].join('\n'),
    'r',
  );
  const refTable = buildTable(refData);
  const m = refTable.rowCount;
  const base = {
    table: refTable,
    visible: new Uint8Array(m).fill(1),
    viewport,
    radii: new Float32Array(m).fill(5),
  };

  it('draws one line at the median / mean in 1D', () => {
    const med = computeLayout({ mode: '1d', field: 'score' }, { ...base, reference: 'median' }, null);
    expect(med.refs).toHaveLength(1);
    expect(med.refs![0].axis).toBe('x');
    expect(med.refs![0].pos).toBeCloseTo(med.tx[2]);
    expect(med.refs![0].label).toBe('Median 9.5');
    const mean = computeLayout({ mode: '1d', field: 'score' }, { ...base, reference: 'mean' }, null);
    expect(mean.refs![0].label).toBe('Mean 8.9');
    const off = computeLayout({ mode: '1d', field: 'score' }, base, null);
    expect(off.refs).toBeUndefined();
  });

  it('positions the statistic with the log scale', () => {
    const res = computeLayout(
      { mode: '1d', field: 'score', log: true },
      { ...base, reference: 'median' },
      null,
    );
    expect(res.refs![0].pos).toBeCloseTo(res.tx[2]);
  });

  it('draws x and y lines in a scatter', () => {
    const res = computeLayout({ mode: '2d', x: 'score', y: 'other' }, { ...base, reference: 'median' }, null);
    expect(res.refs?.map((r) => r.axis)).toEqual(['x', 'y']);
    expect(res.refs![0].pos).toBeCloseTo(res.tx[2]);
    expect(res.refs![1].pos).toBeCloseTo(res.ty[2]);
  });

  it('draws one segment per category in a strip plot (horizontal lanes)', () => {
    const res = computeLayout({ mode: '2d', x: 'score', y: 'team' }, { ...base, reference: 'median' }, null);
    const refs = res.refs!;
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.lane && r.axis === 'x')).toBe(true);
    expect(refs[0].pos).toBeCloseTo(res.tx[1]); // p: 2.5
    expect(refs[1].pos).toBeCloseTo((res.tx[3] + res.tx[4]) / 2); // q: 15.5
    expect((refs[0].from + refs[0].to) / 2).toBeCloseTo(res.ty[0]);
    expect(refs.map((r) => r.label)).toEqual(['2.5', '15.5']);
    const mean = computeLayout({ mode: '2d', x: 'score', y: 'team' }, { ...base, reference: 'mean' }, null);
    // Linear axis: 4.5 sits 3/8 of the way from 1.5 to 9.5.
    expect(mean.refs![0].pos).toBeCloseTo(mean.tx[0] + (mean.tx[2] - mean.tx[0]) * (3 / 8));
  });

  it('draws per-category segments in vertical strip plots and respects filters', () => {
    const visible = Uint8Array.from([1, 1, 0, 1, 1]);
    const res = computeLayout(
      { mode: '2d', x: 'team', y: 'score' },
      { ...base, visible, reference: 'median' },
      null,
    );
    const refs = res.refs!;
    expect(refs.every((r) => r.axis === 'y')).toBe(true);
    expect(refs[0].pos).toBeCloseTo((res.ty[0] + res.ty[1]) / 2); // p without c: 2.0
    expect(refs[0].label).toBe('2');
    expect((refs[1].from + refs[1].to) / 2).toBeCloseTo(res.tx[3]);
  });

  it('is only offered where there is a continuous axis', () => {
    expect(referenceAvailable({ mode: '1d', field: 'score' }, refTable)).toBe(true);
    expect(referenceAvailable({ mode: '1d', field: 'team' }, refTable)).toBe(false);
    expect(referenceAvailable({ mode: '2d', x: 'team', y: 'score' }, refTable)).toBe(true);
    expect(referenceAvailable({ mode: '2d', x: 'team', y: 'team' }, refTable)).toBe(false);
    const withText = buildTable(refData, { name: 'text' });
    expect(referenceAvailable({ mode: '2d', x: 'name', y: 'score' }, withText)).toBe(false);
    expect(referenceAvailable({ mode: 'cluster' }, refTable)).toBe(false);
    const grid = computeLayout({ mode: '2d', x: 'team', y: 'team' }, { ...base, reference: 'mean' }, null);
    expect(grid.refs ?? []).toHaveLength(0);
  });
});

describe('trend line', () => {
  it('fits a perfect line exactly (r = 1) and a known sample', () => {
    const xs = [1, 2, 3, 4, 5];
    const perfect = linearFit(xs, [3, 5, 7, 9, 11], [0, 1, 2, 3, 4])!;
    expect(perfect.slope).toBeCloseTo(2);
    expect(perfect.intercept).toBeCloseTo(1);
    expect(perfect.r).toBeCloseTo(1);
    // Hand-computed: Sxx = 10, Syy = 6, Sxy = 6 → slope 0.6, r = 6 / √60 ≈ 0.7746.
    const sample = linearFit(xs, [2, 4, 5, 4, 5], [0, 1, 2, 3, 4])!;
    expect(sample.slope).toBeCloseTo(0.6);
    expect(sample.intercept).toBeCloseTo(2.2);
    expect(sample.r).toBeCloseTo(0.7746, 3);
    expect(linearFit([1, 1, 1], [1, 2, 3], [0, 1, 2])).toBeNull(); // no spread in x
    expect(linearFit(xs, [1, 2], [0, 1])).toBeNull(); // too few points
    expect(formatR(-0.254)).toBe('r = −0.25');
    expect(formatR(-0.001)).toBe('r = 0.00');
  });

  const lineData = parseDelimited(
    [
      'x,y,g',
      ...Array.from({ length: 12 }, (_, i) => `${i + 1.5},${2 * (i + 1.5) + 3},${'abc'[i % 3]}`),
    ].join('\n'),
    'line',
  );
  const lineTable = buildTable(lineData);
  const lineInput = {
    table: lineTable,
    visible: new Uint8Array(12).fill(1),
    viewport,
    radii: new Float32Array(12).fill(5),
  };

  it('runs through the points of a perfect line, labelled with r', () => {
    const res = computeLayout({ mode: '2d', x: 'x', y: 'y' }, { ...lineInput, trend: true }, null);
    const t = res.trend!;
    expect(t.label).toBe('r = 1.00');
    // Endpoints sit on the first and last bubbles' targets.
    expect(t.x1).toBeCloseTo(res.tx[0]);
    expect(t.y1).toBeCloseTo(res.ty[0]);
    expect(t.x2).toBeCloseTo(res.tx[11]);
    expect(t.y2).toBeCloseTo(res.ty[11]);
    expect(computeLayout({ mode: '2d', x: 'x', y: 'y' }, lineInput, null).trend).toBeUndefined();
  });

  it('stays inside the plot when the fit would leave it', () => {
    // One outlier drags the fitted line below the data's y range at the left.
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const ys = xs.map((x) => (x === 19 ? -400 : 50 + (x % 3)));
    const data = parseDelimited(
      ['x,y', ...xs.map((x, i) => `${x + 0.5},${ys[i] + 0.25}`)].join('\n'),
      'clip',
    );
    const table = buildTable(data);
    const res = computeLayout(
      { mode: '2d', x: 'x', y: 'y' },
      {
        table,
        visible: new Uint8Array(20).fill(1),
        viewport,
        radii: new Float32Array(20).fill(5),
        trend: true,
      },
      null,
    );
    const rect = plotRect(viewport, { xAxis: true, yAxis: true, yLabelWidth: 40 });
    for (const y of [res.trend!.y1, res.trend!.y2]) {
      expect(y).toBeGreaterThanOrEqual(rect.top - 1);
      expect(y).toBeLessThanOrEqual(rect.bottom + 1);
    }
  });

  it('is offered only for scatter plots on linear axes', () => {
    expect(trendAvailable({ mode: '2d', x: 'x', y: 'y' }, lineTable)).toBe(true);
    expect(trendAvailable({ mode: '2d', x: 'x', y: 'y', logX: true }, lineTable)).toBe(false);
    expect(trendAvailable({ mode: '2d', x: 'g', y: 'y' }, lineTable)).toBe(false);
    expect(trendAvailable({ mode: '1d', field: 'x' }, lineTable)).toBe(false);
    const strip = computeLayout({ mode: '2d', x: 'g', y: 'y' }, { ...lineInput, trend: true }, null);
    expect(strip.trend).toBeUndefined();
  });
});
