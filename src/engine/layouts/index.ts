import { isNumericType } from '../../data/profile';
import type { DataTable, FieldMeta, LayoutSpec } from '../../state/types';
import {
  bandAxis,
  bandScale,
  continuousAxis,
  continuousScale,
  countMask,
  formatAxisValue,
  emptyResult,
  estimateLabelWidth,
  fitClusters,
  fitSwarm,
  formatR,
  formatStat,
  gridFor,
  groupRows,
  hiddenMessage,
  linearFit,
  maskedRows,
  plotRect,
  REFERENCE_NAME,
  scaleValue,
  statistic,
  type LayoutInput,
  type LayoutResult,
  type RefGuide,
  type TrendGuide,
} from './common';

export type { LayoutResult, AxisGuide, GroupInfo, RefGuide, TrendGuide, Viewport } from './common';

/** Whether "let bubbles overlap" makes sense: layouts with at least one continuous position. */
export function overlapAllowed(spec: LayoutSpec, table: DataTable): boolean {
  const numeric = (f: string) => {
    const t = table.fieldByName[f]?.type;
    return !!t && isNumericType(t);
  };
  if (spec.mode === 'tsne') return true;
  if (spec.mode === '1d') return numeric(spec.field);
  if (spec.mode === '2d') return numeric(spec.x) || numeric(spec.y);
  return false;
}

/** Whether mean / median reference lines make sense: a continuous axis in 1D or 2D. */
export function referenceAvailable(spec: LayoutSpec, table: DataTable): boolean {
  const type = (f: string) => table.fieldByName[f]?.type;
  const numeric = (f: string) => {
    const t = type(f);
    return !!t && isNumericType(t);
  };
  const usable = (f: string) => !!type(f) && type(f) !== 'text';
  if (spec.mode === '1d') return numeric(spec.field);
  if (spec.mode === '2d') return usable(spec.x) && usable(spec.y) && (numeric(spec.x) || numeric(spec.y));
  return false;
}

/** Whether a least-squares trend line makes sense: a scatter plot on linear axes. */
export function trendAvailable(spec: LayoutSpec, table: DataTable): boolean {
  if (spec.mode !== '2d' || spec.logX || spec.logY) return false;
  const numeric = (f: string) => {
    const t = table.fieldByName[f]?.type;
    return !!t && isNumericType(t);
  };
  return numeric(spec.x) && numeric(spec.y);
}

/** Computes per-row target positions and guides for a layout spec. Pure. */
export function computeLayout(
  spec: LayoutSpec,
  input: LayoutInput,
  tsneCoords: Float32Array | null,
): LayoutResult {
  const { table } = input;
  switch (spec.mode) {
    case 'cluster':
      return clusterLayout(input);
    case '1d': {
      const meta = table.fieldByName[spec.field];
      if (!meta || meta.type === 'text') return clusterLayout(input);
      return isNumericType(meta.type) ? continuous1D(input, meta, !!spec.log) : categorical1D(input, meta);
    }
    case '2d': {
      const x = table.fieldByName[spec.x];
      const y = table.fieldByName[spec.y];
      if (!x || !y || x.type === 'text' || y.type === 'text') return clusterLayout(input);
      return layout2D(input, x, y, !!spec.logX, !!spec.logY);
    }
    case 'tsne':
      return tsneLayout(input, tsneCoords);
  }
}

function clusterLayout({ table, visible, viewport, radii, legend }: LayoutInput): LayoutResult {
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport, {}, legend);
  res.tx.fill(rect.cx);
  res.ty.fill(rect.cy);
  const groupOf = new Int32Array(n).map((_, i) => (visible[i] ? 0 : -1));
  res.radiusScale = fitClusters(groupOf, radii, 1, Math.min(rect.width, rect.height) * 0.95);
  res.strengthX = res.strengthY = 0.06;
  return res;
}

function numericValidity(input: LayoutInput, ...fields: FieldMeta[]): Uint8Array {
  const n = input.table.rowCount;
  const valid = new Uint8Array(n).fill(1);
  for (const f of fields) {
    const col = input.table.columns[f.name];
    if (col.kind !== 'number') continue;
    for (let i = 0; i < n; i++) if (!Number.isFinite(col.values[i])) valid[i] = 0;
  }
  return valid;
}

function hiddenCount(visible: Uint8Array, valid: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < visible.length; i++) if (visible[i] && !valid[i]) c++;
  return c;
}

function andMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((v, i) => v & b[i]);
}

function continuous1D(input: LayoutInput, meta: FieldMeta, log: boolean): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  const col = table.columns[meta.name];
  if (col.kind !== 'number') return res;
  res.valid = numericValidity(input, meta);
  const mask = andMask(visible, res.valid);
  const rect = plotRect(viewport, { xAxis: true }, input.legend);
  const x = continuousScale(table, meta, mask, [rect.left, rect.right], log);
  for (let i = 0; i < n; i++) {
    if (!res.valid[i]) continue;
    res.tx[i] = Math.max(rect.left, Math.min(rect.right, scaleValue(x, col.values[i])));
    res.ty[i] = rect.cy;
  }
  // Slightly smaller bubbles and a strong x pull keep the swarm true to the axis.
  res.radiusScale = Math.min(0.8, fitSwarm(res.tx, null, mask, radii, rect.width / 60, rect.height * 0.9));
  res.strengthX = 0.6;
  res.strengthY = 0.03;
  res.xAxis = continuousAxis(x, meta, 'bottom', rect.bottom, [rect.top, rect.bottom]);
  if (input.reference) {
    const v = statistic(col.values, maskedRows(mask), input.reference);
    if (Number.isFinite(v))
      res.refs = [
        {
          axis: 'x',
          pos: Math.max(rect.left, Math.min(rect.right, scaleValue(x, v))),
          from: rect.top,
          to: rect.bottom,
          label: `${REFERENCE_NAME[input.reference]} ${formatStat(meta, v)}`,
        },
      ];
  }
  res.message = hiddenMessage(hiddenCount(visible, res.valid), meta.name);
  return res;
}

function categorical1D(input: LayoutInput, meta: FieldMeta): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport, {}, input.legend);
  const grouping = groupRows(table, meta, visible);
  const g = grouping.keys.length;
  if (g === 0) return res;
  const LABEL_SPACE = 30;
  const { cols, rows } = gridFor(g, rect.width, rect.height);
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const centers = grouping.keys.map((_, k) => {
    const r = Math.floor(k / cols);
    const c = k % cols;
    const inRow = r === rows - 1 ? g - r * cols : cols;
    const offset = ((cols - inRow) * cellW) / 2;
    return [rect.left + offset + cellW * (c + 0.5), rect.top + cellH * (r + 0.5) - LABEL_SPACE / 2];
  });
  for (let i = 0; i < n; i++) {
    const k = grouping.nodeGroup[i];
    if (k < 0) continue;
    res.tx[i] = centers[k][0];
    res.ty[i] = centers[k][1];
  }
  res.radiusScale = fitClusters(grouping.nodeGroup, radii, g, Math.min(cellW, cellH - LABEL_SPACE) * 0.9);
  res.strengthX = res.strengthY = g > 12 ? 0.14 : 0.1;
  res.groups = { field: meta.name, keys: grouping.keys, nodeGroup: grouping.nodeGroup };
  return res;
}

function layout2D(
  input: LayoutInput,
  xm: FieldMeta,
  ym: FieldMeta,
  logX: boolean,
  logY: boolean,
): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  res.valid = numericValidity(input, xm, ym);
  const mask = andMask(visible, res.valid);
  const xCont = isNumericType(xm.type);
  const yCont = isNumericType(ym.type);
  const yLabels = yCont
    ? [formatAxisValue(ym, ym.min ?? 0), formatAxisValue(ym, ym.max ?? 0)]
    : groupRows(table, ym, mask, 20).keys;
  const rect = plotRect(
    viewport,
    { xAxis: true, yAxis: true, yLabelWidth: estimateLabelWidth(yLabels) },
    input.legend,
  );

  // Strip plots: inset the continuous axis a little so bubbles at its ends swarm clear
  // of the category labels instead of sitting on top of them.
  const stripPad = (length: number) => (xCont !== yCont ? Math.min(36, length * 0.04) : 0);
  const axis = (meta: FieldMeta, cont: boolean, orient: 'bottom' | 'left') => {
    const pad = cont ? stripPad(orient === 'bottom' ? rect.width : rect.height) : 0;
    const range: [number, number] =
      orient === 'bottom' ? [rect.left + pad, rect.right - pad] : [rect.bottom - pad, rect.top + pad];
    const cross = orient === 'bottom' ? rect.bottom : rect.left;
    const span: [number, number] = orient === 'bottom' ? [rect.top, rect.bottom] : [rect.left, rect.right];
    if (cont) {
      const scale = continuousScale(table, meta, mask, range, orient === 'bottom' ? logX : logY);
      const col = table.columns[meta.name];
      const lo = Math.min(...range);
      const hi = Math.max(...range);
      const at = (v: number) => Math.max(lo, Math.min(hi, scaleValue(scale, v)));
      const domain = (scale.domain() as (number | Date)[]).map(Number) as [number, number];
      return {
        /** The axis' data range (after nice rounding). */
        domain,
        pos: (i: number) => at(col.kind === 'number' ? col.values[i] : NaN),
        /** Position of a data value on this axis (continuous axes only). */
        at,
        values: col.kind === 'number' ? col.values : null,
        lane: null as Int32Array | null,
        centers: [] as number[],
        step: 0,
        guide: continuousAxis(scale, meta, orient, cross, span),
      };
    }
    const grouping = groupRows(table, meta, mask, orient === 'bottom' ? 16 : 20);
    const scale = bandScale(grouping.keys, range);
    const centers = grouping.keys.map((k) => scale(k)!);
    return {
      pos: (i: number) => (grouping.nodeGroup[i] >= 0 ? centers[grouping.nodeGroup[i]] : NaN),
      domain: null,
      at: null,
      values: null,
      lane: grouping.nodeGroup,
      centers,
      step: scale.step(),
      guide: bandAxis(scale, meta.name, orient, cross, span),
    };
  };
  const X = axis(xm, xCont, 'bottom');
  const Y = axis(ym, yCont, 'left');

  for (let i = 0; i < n; i++) {
    if (!res.valid[i]) continue;
    res.tx[i] = X.pos(i);
    res.ty[i] = Y.pos(i);
  }
  res.xAxis = X.guide;
  res.yAxis = Y.guide;
  if (input.reference) res.refs = references2D(input.reference, mask, rect, [X, Y], [xm, ym]);
  if (input.trend && xCont && yCont && !logX && !logY) res.trend = trendLine(mask, rect, X, Y);

  if (xCont && yCont) {
    // Scatter: keep positions accurate, allow overlap.
    res.strengthX = res.strengthY = 0.3;
    res.collide = 0.25;
    res.radiusScale = 0.85;
  } else if (xCont !== yCont) {
    // Strip plot: swarm along the continuous axis within each category lane.
    const lanes = (xCont ? Y.lane : X.lane)!;
    const along = xCont ? res.tx : res.ty;
    const step = xCont ? Y.step : X.step;
    const binSize = (xCont ? rect.width : rect.height) / 50;
    res.radiusScale = fitSwarm(along, lanes, mask, radii, binSize, step * 0.85);
    res.strengthX = xCont ? 0.35 : 0.06;
    res.strengthY = xCont ? 0.06 : 0.35;
  } else {
    // Grid of clusters.
    const gy = Y.lane!;
    const gx = X.lane!;
    const ny = Math.max(1, Y.guide.ticks.length);
    const combined = new Int32Array(n).map((_, i) => (gx[i] >= 0 && gy[i] >= 0 ? gx[i] * ny + gy[i] : -1));
    res.radiusScale = fitClusters(combined, radii, X.guide.ticks.length * ny, Math.min(X.step, Y.step) * 0.9);
    res.strengthX = res.strengthY = 0.12;
  }
  res.message = hiddenMessage(
    hiddenCount(visible, res.valid),
    [xm, ym]
      .filter((m) => isNumericType(m.type))
      .map((m) => m.name)
      .join(' or '),
  );
  return res;
}

interface AxisPlacement {
  at: ((v: number) => number) | null;
  values: Float64Array | Float32Array | null;
  lane: Int32Array | null;
  centers: number[];
  step: number;
}

/**
 * Reference lines for 2D layouts. Scatter: one line per continuous axis across
 * the plot. Strip plot: one short segment per category lane at that lane's statistic.
 */
function references2D(
  kind: 'mean' | 'median',
  mask: Uint8Array,
  rect: { left: number; right: number; top: number; bottom: number },
  [X, Y]: [AxisPlacement, AxisPlacement],
  [xm, ym]: [FieldMeta, FieldMeta],
): RefGuide[] {
  const refs: RefGuide[] = [];
  const name = REFERENCE_NAME[kind];
  if (X.at && Y.at) {
    const vx = statistic(X.values!, maskedRows(mask), kind);
    const vy = statistic(Y.values!, maskedRows(mask), kind);
    if (Number.isFinite(vx))
      refs.push({
        axis: 'x',
        pos: X.at(vx),
        from: rect.top,
        to: rect.bottom,
        label: `${name} ${formatStat(xm, vx)}`,
      });
    if (Number.isFinite(vy))
      refs.push({
        axis: 'y',
        pos: Y.at(vy),
        from: rect.left,
        to: rect.right,
        label: `${name} ${formatStat(ym, vy)}`,
      });
    return refs;
  }
  const cont = X.at ? X : Y.at ? Y : null;
  const band = X.at ? Y : X;
  if (!cont || !band.lane) return refs;
  const meta = X.at ? xm : ym;
  const half = band.step * 0.4;
  band.centers.forEach((c, k) => {
    const v = statistic(cont.values!, maskedRows(mask, band.lane!, k), kind);
    if (!Number.isFinite(v)) return;
    refs.push({
      axis: X.at ? 'x' : 'y',
      pos: cont.at!(v),
      from: c - half,
      to: c + half,
      label: formatStat(meta, v),
      lane: true,
    });
  });
  return refs;
}

/**
 * Least-squares line across the data's x range, clipped to the plot's y range, in
 * world coordinates; labelled with Pearson's r. Fitted in data space (linear axes).
 */
function trendLine(
  mask: Uint8Array,
  rect: { left: number; right: number; top: number },
  X: AxisPlacement & { domain: [number, number] | null },
  Y: AxisPlacement & { domain: [number, number] | null },
): TrendGuide | undefined {
  if (!X.at || !Y.at || !X.values || !Y.values || !Y.domain) return undefined;
  const fit = linearFit(X.values, Y.values, maskedRows(mask));
  if (!fit) return undefined;
  const yAt = (x: number) => fit.intercept + fit.slope * x;
  let x1 = fit.xMin;
  let x2 = fit.xMax;
  // Clip where the line leaves the y axis' range.
  const [yLo, yHi] = [Math.min(...Y.domain), Math.max(...Y.domain)];
  if (fit.slope !== 0) {
    const xAtLo = (yLo - fit.intercept) / fit.slope;
    const xAtHi = (yHi - fit.intercept) / fit.slope;
    const [a, b] = [Math.min(xAtLo, xAtHi), Math.max(xAtLo, xAtHi)];
    x1 = Math.max(x1, a);
    x2 = Math.min(x2, b);
    if (!(x2 > x1)) return undefined;
  } else if (fit.intercept < yLo || fit.intercept > yHi) return undefined;
  // Label in the corner the trend leaves empty: top-left when it rises, top-right otherwise.
  const rising = fit.slope > 0;
  return {
    x1: X.at(x1),
    y1: Y.at(yAt(x1)),
    x2: X.at(x2),
    y2: Y.at(yAt(x2)),
    label: formatR(fit.r),
    lx: rising ? rect.left + 12 : rect.right - 12,
    ly: rect.top + 20,
    anchor: rising ? 'start' : 'end',
  };
}

function tsneLayout(
  { table, visible, viewport, legend }: LayoutInput,
  coords: Float32Array | null,
): LayoutResult {
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport, {}, legend);
  if (!coords) {
    res.valid = visible.slice();
    res.message = 'Computing t-SNE…';
    return res;
  }
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = coords[i * 2];
    const y = coords[i * 2 + 1];
    res.valid[i] = Number.isFinite(x) && Number.isFinite(y) ? 1 : 0;
    if (!res.valid[i]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return res;
  // Inset: points sharing near-identical targets pack into blobs that extend past them.
  const s = 0.86 * Math.min(rect.width / Math.max(1e-9, x1 - x0), rect.height / Math.max(1e-9, y1 - y0));
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  for (let i = 0; i < n; i++) {
    if (!res.valid[i]) continue;
    res.tx[i] = rect.cx + (coords[i * 2] - mx) * s;
    res.ty[i] = rect.cy + (coords[i * 2 + 1] - my) * s;
  }
  res.strengthX = res.strengthY = 0.2;
  res.collide = 0.6;
  res.radiusScale = 0.85;
  if (countMask(res.valid) === 0) res.message = 'Computing t-SNE…';
  return res;
}
