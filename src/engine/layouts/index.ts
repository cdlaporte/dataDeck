import { isNumericType } from '../../data/profile';
import type { FieldMeta, LayoutSpec } from '../../state/types';
import {
  bandAxis,
  bandScale,
  continuousAxis,
  continuousScale,
  countMask,
  emptyResult,
  fitClusters,
  fitSwarm,
  gridFor,
  groupRows,
  hiddenMessage,
  plotRect,
  scaleValue,
  type LayoutInput,
  type LayoutResult,
} from './common';

export type { LayoutResult, AxisGuide, GroupInfo, Viewport } from './common';

/** Computes per-row target positions and guides for a layout spec. Pure. */
export function computeLayout(spec: LayoutSpec, input: LayoutInput, tsneCoords: Float32Array | null): LayoutResult {
  const { table } = input;
  switch (spec.mode) {
    case 'cluster':
      return clusterLayout(input);
    case '1d': {
      const meta = table.fieldByName[spec.field];
      if (!meta || meta.type === 'text') return clusterLayout(input);
      return isNumericType(meta.type) ? continuous1D(input, meta) : categorical1D(input, meta);
    }
    case '2d': {
      const x = table.fieldByName[spec.x];
      const y = table.fieldByName[spec.y];
      if (!x || !y || x.type === 'text' || y.type === 'text') return clusterLayout(input);
      return layout2D(input, x, y);
    }
    case 'tsne':
      return tsneLayout(input, tsneCoords);
  }
}

function clusterLayout({ table, visible, viewport, radii }: LayoutInput): LayoutResult {
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport);
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

function continuous1D(input: LayoutInput, meta: FieldMeta): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  const col = table.columns[meta.name];
  if (col.kind !== 'number') return res;
  res.valid = numericValidity(input, meta);
  const mask = andMask(visible, res.valid);
  const rect = plotRect(viewport, { xAxis: true });
  const x = continuousScale(table, meta, mask, [rect.left, rect.right]);
  for (let i = 0; i < n; i++) {
    if (!res.valid[i]) continue;
    res.tx[i] = Math.max(rect.left, Math.min(rect.right, scaleValue(x, col.values[i])));
    res.ty[i] = rect.cy;
  }
  res.radiusScale = fitSwarm(res.tx, null, mask, radii, rect.width / 60, rect.height * 0.9);
  res.strengthX = 0.35;
  res.strengthY = 0.045;
  res.xAxis = continuousAxis(x, meta, 'bottom', rect.bottom, [rect.top, rect.bottom]);
  res.message = hiddenMessage(hiddenCount(visible, res.valid), meta.name);
  return res;
}

function categorical1D(input: LayoutInput, meta: FieldMeta): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport);
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

function layout2D(input: LayoutInput, xm: FieldMeta, ym: FieldMeta): LayoutResult {
  const { table, visible, viewport, radii } = input;
  const n = table.rowCount;
  const res = emptyResult(n);
  res.valid = numericValidity(input, xm, ym);
  const mask = andMask(visible, res.valid);
  const rect = plotRect(viewport, { xAxis: true, yAxis: true });
  const xCont = isNumericType(xm.type);
  const yCont = isNumericType(ym.type);

  const axis = (meta: FieldMeta, cont: boolean, orient: 'bottom' | 'left') => {
    const range: [number, number] = orient === 'bottom' ? [rect.left, rect.right] : [rect.bottom, rect.top];
    const cross = orient === 'bottom' ? rect.bottom : rect.left;
    const span: [number, number] = orient === 'bottom' ? [rect.top, rect.bottom] : [rect.left, rect.right];
    if (cont) {
      const scale = continuousScale(table, meta, mask, range);
      const col = table.columns[meta.name];
      const lo = Math.min(...range);
      const hi = Math.max(...range);
      return {
        pos: (i: number) => Math.max(lo, Math.min(hi, scaleValue(scale, col.kind === 'number' ? col.values[i] : NaN))),
        lane: null as Int32Array | null,
        step: 0,
        guide: continuousAxis(scale, meta, orient, cross, span),
      };
    }
    const grouping = groupRows(table, meta, mask, orient === 'bottom' ? 16 : 20);
    const scale = bandScale(grouping.keys, range);
    const centers = grouping.keys.map((k) => scale(k)!);
    return {
      pos: (i: number) => (grouping.nodeGroup[i] >= 0 ? centers[grouping.nodeGroup[i]] : NaN),
      lane: grouping.nodeGroup,
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
  res.message = hiddenMessage(hiddenCount(visible, res.valid), [xm, ym].filter((m) => isNumericType(m.type)).map((m) => m.name).join(' or '));
  return res;
}

function tsneLayout({ table, visible, viewport }: LayoutInput, coords: Float32Array | null): LayoutResult {
  const n = table.rowCount;
  const res = emptyResult(n);
  const rect = plotRect(viewport);
  if (!coords) {
    res.valid = visible.slice();
    res.message = 'Computing t-SNE…';
    return res;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
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
  const s = Math.min(rect.width / Math.max(1e-9, x1 - x0), rect.height / Math.max(1e-9, y1 - y0));
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
