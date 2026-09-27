import { scaleLinear, scalePoint, scaleUtc, type ScaleLinear, type ScalePoint, type ScaleTime } from 'd3-scale';
import { formatDate, formatNumber } from '../../data/format';
import { MISSING_KEY } from '../../data/filters';
import type { DataTable, FieldMeta } from '../../state/types';

export interface Viewport {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface AxisGuide {
  orient: 'bottom' | 'left';
  title: string;
  /** Tick positions are world coordinates along the axis. */
  ticks: { pos: number; label: string }[];
  /** World coordinate of the axis line on the cross axis. */
  cross: number;
  /** Extent of gridlines on the cross axis. */
  span: [number, number];
  /** Whether to draw gridlines (continuous axes) or not (band axes). */
  grid: boolean;
}

export interface GroupInfo {
  field: string;
  keys: string[];
  /** Group index per row, -1 when the row is not placed. */
  nodeGroup: Int32Array;
}

export interface LayoutResult {
  /** World-space targets; NaN = keep the node's previous target. */
  tx: Float32Array;
  ty: Float32Array;
  /** Rows this layout can place (e.g. rows with a value for the chosen field). */
  valid: Uint8Array;
  strengthX: number;
  strengthY: number;
  collide: number;
  /** Multiplier applied to bubble radii so the layout fits the plot area. */
  radiusScale: number;
  xAxis?: AxisGuide;
  yAxis?: AxisGuide;
  /** Groups whose labels float under their live clusters. */
  groups?: GroupInfo;
  /** Short status line shown on the stage (e.g. hidden-row count). */
  message?: string;
}

export interface LayoutInput {
  table: DataTable;
  /** Filter mask (1 = passes filters). */
  visible: Uint8Array;
  viewport: Viewport;
  /** Unscaled target radii per row. */
  radii: Float32Array;
}

export const MAX_GROUPS = 24;
export const OTHER_KEY = 'Other';

export function plotRect(vp: Viewport, opts: { yAxis?: boolean; xAxis?: boolean } = {}): Rect {
  const small = vp.width < 640;
  const left = opts.yAxis ? (small ? 56 : 88) : small ? 20 : 48;
  const right = small ? 20 : 48;
  const top = small ? 72 : 104;
  const bottom = opts.xAxis ? (small ? 56 : 72) : small ? 32 : 56;
  const width = Math.max(40, vp.width - left - right);
  const height = Math.max(40, vp.height - top - bottom);
  return { left, top, right: left + width, bottom: top + height, width, height, cx: left + width / 2, cy: top + height / 2 };
}

export function emptyResult(n: number): LayoutResult {
  return {
    tx: new Float32Array(n).fill(NaN),
    ty: new Float32Array(n).fill(NaN),
    valid: new Uint8Array(n).fill(1),
    strengthX: 0.08,
    strengthY: 0.08,
    collide: 1,
    radiusScale: 1,
  };
}

// ---------------------------------------------------------------------------
// Continuous scales

export type ContinuousScale = ScaleLinear<number, number> | ScaleTime<number, number>;

export function continuousScale(
  table: DataTable,
  meta: FieldMeta,
  mask: Uint8Array,
  range: [number, number],
): ContinuousScale {
  const col = table.columns[meta.name];
  let lo = Infinity;
  let hi = -Infinity;
  if (col.kind === 'number') {
    for (let i = 0; i < table.rowCount; i++) {
      if (!mask[i]) continue;
      const v = col.values[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  if (lo === hi) {
    const pad = meta.type === 'date' ? 86400000 * 180 : Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  if (meta.type === 'date') return scaleUtc().domain([new Date(lo), new Date(hi)]).range(range).nice();
  return scaleLinear().domain([lo, hi]).range(range).nice();
}

export function continuousAxis(
  scale: ContinuousScale,
  meta: FieldMeta,
  orient: AxisGuide['orient'],
  cross: number,
  span: [number, number],
): AxisGuide {
  const [r0, r1] = scale.range();
  const count = Math.max(2, Math.round(Math.abs(r1 - r0) / (orient === 'bottom' ? 110 : 70)));
  let ticks: { pos: number; label: string }[];
  if (meta.type === 'date') {
    const s = scale as ScaleTime<number, number>;
    const fmt = s.tickFormat(count);
    ticks = s.ticks(count).map((d) => ({ pos: s(d), label: fmt(d) }));
  } else {
    const s = scale as ScaleLinear<number, number>;
    ticks = s.ticks(count).map((v) => ({ pos: s(v), label: formatNumber(v) }));
  }
  return { orient, title: meta.name, ticks, cross, span, grid: true };
}

export function scaleValue(scale: ContinuousScale, v: number): number {
  return (scale as ScaleLinear<number, number>)(v as number);
}

// ---------------------------------------------------------------------------
// Categorical groups

export interface Grouping {
  keys: string[];
  nodeGroup: Int32Array;
  counts: number[];
}

/** Groups visible rows by a categorical field in the profiler's category order,
 *  folding the long tail into "Other" and missing values into their own group. */
export function groupRows(table: DataTable, meta: FieldMeta, mask: Uint8Array, maxGroups = MAX_GROUPS): Grouping {
  const col = table.columns[meta.name];
  const n = table.rowCount;
  const present = new Map<string, number>();
  const valueOf = (i: number) => (col.kind === 'string' ? col.values[i] : null) ?? MISSING_KEY;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const v = valueOf(i);
    present.set(v, (present.get(v) ?? 0) + 1);
  }
  const ordered = (meta.categories ?? []).map((c) => c.value).filter((v) => present.has(v));
  if (present.has(MISSING_KEY)) ordered.push(MISSING_KEY);

  let keys = ordered;
  if (ordered.length > maxGroups) {
    const byCount = [...ordered].sort((a, b) => present.get(b)! - present.get(a)!);
    const keep = new Set(byCount.slice(0, maxGroups - 1));
    keys = [...ordered.filter((k) => keep.has(k)), OTHER_KEY];
  }
  const index = new Map(keys.map((k, i) => [k, i]));
  const other = index.get(OTHER_KEY) ?? -1;
  const nodeGroup = new Int32Array(n).fill(-1);
  const counts = new Array(keys.length).fill(0);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const g = index.get(valueOf(i)) ?? other;
    nodeGroup[i] = g;
    if (g >= 0) counts[g]++;
  }
  return { keys, nodeGroup, counts };
}

export function bandScale(keys: string[], range: [number, number]): ScalePoint<string> {
  return scalePoint<string>().domain(keys).range(range).padding(0.5);
}

export function bandAxis(
  scale: ScalePoint<string>,
  title: string,
  orient: AxisGuide['orient'],
  cross: number,
  span: [number, number],
): AxisGuide {
  return {
    orient,
    title,
    ticks: scale.domain().map((k) => ({ pos: scale(k)!, label: k })),
    cross,
    span,
    grid: false,
  };
}

/** Chooses a grid (cols × rows) for g equal cells that maximises cell size. */
export function gridFor(g: number, width: number, height: number): { cols: number; rows: number } {
  let best = { cols: 1, rows: g, size: 0 };
  for (let cols = 1; cols <= g; cols++) {
    const rows = Math.ceil(g / cols);
    const size = Math.min(width / cols, height / rows);
    if (size > best.size) best = { cols, rows, size };
  }
  return { cols: best.cols, rows: best.rows };
}

// ---------------------------------------------------------------------------
// Fitting: shrink bubbles when a layout would overflow its space.

const PACKING = 0.72;

/** Scale factor so that every group's packed cluster diameter fits `available`. */
export function fitClusters(groupOf: Int32Array, radii: Float32Array, groups: number, available: number): number {
  const area = new Float64Array(groups);
  for (let i = 0; i < groupOf.length; i++) if (groupOf[i] >= 0) area[groupOf[i]] += Math.PI * radii[i] ** 2;
  let needed = 0;
  for (const a of area) needed = Math.max(needed, 2 * Math.sqrt(a / PACKING / Math.PI));
  return needed > available ? available / needed : 1;
}

/** Scale factor for beeswarm-style layouts: nodes bunch along `pos` (bins of `binSize`)
 *  within lanes (`laneOf`) and spread perpendicular to it, limited to `available`. */
export function fitSwarm(
  pos: Float32Array,
  laneOf: Int32Array | null,
  mask: Uint8Array,
  radii: Float32Array,
  binSize: number,
  available: number,
): number {
  const bins = new Map<number, number>();
  for (let i = 0; i < pos.length; i++) {
    if (!mask[i] || !Number.isFinite(pos[i])) continue;
    const key = Math.floor(pos[i] / binSize) * 10000 + (laneOf ? laneOf[i] : 0);
    bins.set(key, (bins.get(key) ?? 0) + Math.PI * radii[i] ** 2);
  }
  let needed = 0;
  for (const a of bins.values()) needed = Math.max(needed, a / binSize / PACKING);
  return needed > available ? Math.sqrt(available / needed) : 1;
}

export function countMask(mask: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i];
  return c;
}

export function hiddenMessage(hidden: number, field: string): string | undefined {
  if (hidden <= 0) return undefined;
  return `${hidden.toLocaleString()} ${hidden === 1 ? 'row has' : 'rows have'} no ${field} and ${hidden === 1 ? 'is' : 'are'} hidden`;
}

export function formatAxisValue(meta: FieldMeta, v: number): string {
  return meta.type === 'date' ? formatDate(v) : formatNumber(v, meta);
}
