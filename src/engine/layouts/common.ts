import {
  scaleLinear,
  scaleLog,
  scalePoint,
  scaleSymlog,
  scaleUtc,
  type ScaleLinear,
  type ScaleLogarithmic,
  type ScalePoint,
  type ScaleSymLog,
  type ScaleTime,
} from 'd3-scale';
import { format } from 'd3-format';
import { formatDate, formatNumber } from '../../data/format';
import { MISSING_KEY } from '../../data/filters';
import type { DataTable, FieldMeta, ReferenceKind } from '../../state/types';

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

/** A mean / median reference line, in world coordinates. */
export interface RefGuide {
  /** Axis the value is measured on: 'x' draws a vertical line, 'y' a horizontal one. */
  axis: 'x' | 'y';
  /** Position of the line along its axis. */
  pos: number;
  /** Extent of the line on the cross axis. */
  from: number;
  to: number;
  label: string;
  /** Per-category segment in a strip plot (shorter, value-only label). */
  lane?: boolean;
}

/** Least-squares trend line (world coordinates) and its correlation label. */
export interface TrendGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** e.g. "r = 0.82" */
  label: string;
  /** Label position (world): the plot corner the trend leaves empty. */
  lx: number;
  ly: number;
  anchor: 'start' | 'end';
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
  /** Mean / median reference lines. */
  refs?: RefGuide[];
  /** Least-squares trend line (scatter plots). */
  trend?: TrendGuide;
  /** Groups whose labels float under their live clusters. */
  groups?: GroupInfo;
  /** Short status line shown on the stage (e.g. hidden-row count). */
  message?: string;
}

export interface LayoutInput {
  table: DataTable;
  /** Whether a legend is shown (reserves space on the right). */
  legend?: boolean;
  /** Filter mask (1 = passes filters). */
  visible: Uint8Array;
  viewport: Viewport;
  /** Unscaled target radii per row. */
  radii: Float32Array;
  /** Draw mean / median reference lines where the layout supports them. */
  reference?: ReferenceKind;
  /** Draw a least-squares trend line with Pearson's r (scatter plots). */
  trend?: boolean;
}

export const MAX_GROUPS = 24;
export const OTHER_KEY = 'Other';

export interface PlotOptions {
  xAxis?: boolean;
  yAxis?: boolean;
  /** Approximate width of the widest y tick label (px). */
  yLabelWidth?: number;
}

/** Plot area inside the viewport, leaving room for the title, legend, axes and toolbar. */
export function plotRect(vp: Viewport, opts: PlotOptions = {}, legend = false): Rect {
  const small = vp.width < 640;
  const yLabel = Math.min(180, Math.max(36, opts.yLabelWidth ?? 36));
  const left = opts.yAxis ? (small ? 24 : 40) + yLabel + 12 : small ? 20 : 48;
  const right = legend && !small ? 200 : small ? 20 : 48;
  const top = small ? 72 : 108;
  const bottom = opts.xAxis ? (small ? 102 : 136) : small ? 72 : 84;
  const width = Math.max(40, vp.width - left - right);
  const height = Math.max(40, vp.height - top - bottom);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    cx: left + width / 2,
    cy: top + height / 2,
  };
}

/** Rough label width without DOM measurement (keeps layouts pure). */
export function estimateLabelWidth(labels: string[], px = 13): number {
  let max = 0;
  for (const l of labels) max = Math.max(max, l.length);
  return max * px * 0.58;
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

export type ContinuousScale =
  | ScaleLinear<number, number>
  | ScaleTime<number, number>
  | ScaleLogarithmic<number, number>
  | ScaleSymLog<number, number>;

const isLogScale = (s: ContinuousScale): s is ScaleLogarithmic<number, number> =>
  typeof (s as ScaleLogarithmic<number, number>).base === 'function';
const isSymlogScale = (s: ContinuousScale): s is ScaleSymLog<number, number> =>
  typeof (s as ScaleSymLog<number, number>).constant === 'function';

/**
 * Scale for a numeric/date field over the visible rows. With `log`, quantitative
 * fields use a log scale when every value is positive, otherwise a symmetric-log
 * scale (handles zeros and negatives, e.g. box-office grosses of 0).
 */
export function continuousScale(
  table: DataTable,
  meta: FieldMeta,
  mask: Uint8Array,
  range: [number, number],
  log = false,
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
  if (meta.type === 'date')
    return scaleUtc()
      .domain([new Date(lo), new Date(hi)])
      .range(range)
      .nice();
  if (log && meta.type === 'quantitative') {
    if (lo > 0) return scaleLog().domain([lo, hi]).range(range).nice();
    return scaleSymlog().constant(1).domain([lo, hi]).range(range).nice();
  }
  return scaleLinear().domain([lo, hi]).range(range).nice();
}

/** Tick values for log scales: powers of ten (plus 2× and 5× when the range spans few decades). */
export function logTicks(lo: number, hi: number, symmetric: boolean, max = 9): number[] {
  const out = new Set<number>();
  const decades = (a: number, b: number, sign: 1 | -1) => {
    // Positive magnitudes in [a, b], a > 0.
    const k0 = Math.floor(Math.log10(a));
    const k1 = Math.ceil(Math.log10(b));
    const powers: number[] = [];
    for (let k = k0; k <= k1; k++) powers.push(10 ** k);
    const inRange = (v: number) => v >= a * (1 - 1e-9) && v <= b * (1 + 1e-9);
    let values = powers.filter(inRange);
    if (values.length < 3) {
      values = powers.flatMap((p) => [p, 2 * p, 5 * p]).filter(inRange);
    }
    for (const v of values) out.add(sign * v);
  };
  if (symmetric) {
    if (lo <= 0 && hi >= 0) out.add(0);
    if (hi >= 1) decades(1, hi, 1);
    if (lo <= -1) decades(1, -lo, -1);
  } else if (lo > 0) {
    decades(lo, hi, 1);
  }
  let ticks = [...out].sort((a, b) => a - b);
  // Thin evenly (keeping the ends) when there are too many.
  if (ticks.length > max) {
    const step = Math.ceil(ticks.length / max);
    ticks = ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1);
  }
  return ticks;
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
  } else if (isLogScale(scale) || isSymlogScale(scale)) {
    const [d0, d1] = scale.domain() as [number, number];
    const values = logTicks(Math.min(d0, d1), Math.max(d0, d1), isSymlogScale(scale), Math.max(4, count + 2));
    ticks = values.map((v) => ({ pos: scale(v), label: formatNumber(v) }));
    return { orient, title: `${meta.name} (log)`, ticks, cross, span, grid: true };
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
export function groupRows(
  table: DataTable,
  meta: FieldMeta,
  mask: Uint8Array,
  maxGroups = MAX_GROUPS,
): Grouping {
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
export function fitClusters(
  groupOf: Int32Array,
  radii: Float32Array,
  groups: number,
  available: number,
): number {
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
  return meta.type === 'date' ? formatDate(v, meta.dateUnit) : formatNumber(v, meta);
}

// ---------------------------------------------------------------------------
// Reference statistics

/** Mean or median of `values` over the rows in `rows` (non-finite values skipped); NaN when empty. */
export function statistic(values: ArrayLike<number>, rows: Iterable<number>, kind: ReferenceKind): number {
  const xs: number[] = [];
  for (const i of rows) {
    const v = values[i];
    if (Number.isFinite(v)) xs.push(v);
  }
  if (!xs.length) return NaN;
  if (kind === 'mean') {
    let sum = 0;
    for (const v of xs) sum += v;
    return sum / xs.length;
  }
  xs.sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Row indices where `mask` is set (and, with `lanes`, whose lane equals `lane`). */
export function* maskedRows(mask: Uint8Array, lanes?: Int32Array, lane?: number): Generator<number> {
  for (let i = 0; i < mask.length; i++) if (mask[i] && (!lanes || lanes[i] === lane)) yield i;
}

const statThousands = format(',.0f');
const statHundreds = format(',.1~f');

/** Label text for a reference value: dates as dates; decimals shrink as magnitudes grow. */
export function formatStat(meta: FieldMeta, v: number): string {
  if (meta.type === 'date') return formatDate(v, meta.dateUnit);
  const a = Math.abs(v);
  if (a >= 1e6) return formatNumber(v);
  if (a >= 1000) return statThousands(v);
  if (a >= 100) return statHundreds(v);
  return formatNumber(v);
}

export const REFERENCE_NAME: Record<ReferenceKind, string> = { mean: 'Mean', median: 'Median' };

// ---------------------------------------------------------------------------
// Trend line

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Pearson correlation coefficient. */
  r: number;
  n: number;
  xMin: number;
  xMax: number;
}

/**
 * Least-squares line y = intercept + slope·x and Pearson's r over `rows` (rows
 * with a non-finite x or y are skipped). Null with fewer than 3 points or no
 * spread in x.
 */
export function linearFit(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  rows: Iterable<number>,
): LinearFit | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  const kept: number[] = [];
  for (const i of rows) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    kept.push(i);
    n++;
    sx += x;
    sy += y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  if (n < 3) return null;
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const i of kept) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  return { slope, intercept: my - slope * mx, r, n, xMin, xMax };
}

/** "r = 0.82" / "r = −0.25" (typographic minus). */
export function formatR(r: number): string {
  const v = (Math.abs(r) < 0.005 ? 0 : r).toFixed(2);
  return `r = ${v.startsWith('-') ? `\u2212${v.slice(1)}` : v}`;
}
