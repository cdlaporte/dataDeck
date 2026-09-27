import { color as parseColor } from 'd3-color';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { MISSING_KEY } from '../data/filters';
import type { DataTable, Encoding } from '../state/types';
import { CATEGORICAL, DEFAULT_COLOR, MAX_CATEGORY_COLORS, NEUTRAL, SEQUENTIAL, type ThemeName } from './palette';

export type ColorLegend =
  | { kind: 'none' }
  | { kind: 'categorical'; field: string; items: { label: string; color: string }[] }
  | { kind: 'sequential'; field: string; fieldType: 'quantitative' | 'date'; min: number; max: number; stops: string[] };

export interface ColorEncoding {
  legend: ColorLegend;
  /** RGB in 0..1, length 3n. */
  rgb: Float32Array;
}

function hexToRgb(c: string): [number, number, number] {
  const p = parseColor(c)?.rgb();
  return p ? [p.r / 255, p.g / 255, p.b / 255] : [0.5, 0.5, 0.5];
}

/** Colour legend for a field. Category→colour assignment uses the full dataset
 *  order so filters never repaint surviving categories. */
export function colorLegend(table: DataTable, field: string | null, theme: ThemeName): ColorLegend {
  const meta = field ? table.fieldByName[field] : undefined;
  if (!field || !meta) return { kind: 'none' };
  if (meta.type === 'quantitative' || meta.type === 'date') {
    if (meta.min === undefined || meta.max === undefined) return { kind: 'none' };
    return { kind: 'sequential', field, fieldType: meta.type, min: meta.min, max: meta.max, stops: SEQUENTIAL[theme] };
  }
  const cats = meta.categories ?? [];
  const palette = CATEGORICAL[theme];
  const overflow = cats.length > MAX_CATEGORY_COLORS;
  const named = overflow ? cats.slice(0, MAX_CATEGORY_COLORS - 1) : cats;
  const items = named.map((c, i) => ({ label: c.value, color: palette[i] }));
  if (overflow) items.push({ label: `Other (${cats.length - named.length})`, color: NEUTRAL[theme] });
  if (meta.missing > 0) items.push({ label: MISSING_KEY, color: NEUTRAL[theme] });
  return { kind: 'categorical', field, items };
}

export function computeColors(table: DataTable, encoding: Encoding, theme: ThemeName): ColorEncoding {
  const n = table.rowCount;
  const rgb = new Float32Array(n * 3);
  const legend = colorLegend(table, encoding.color, theme);
  const neutral = hexToRgb(NEUTRAL[theme]);
  const put = (i: number, c: [number, number, number]) => {
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  };

  if (legend.kind === 'none') {
    const c = hexToRgb(DEFAULT_COLOR[theme]);
    for (let i = 0; i < n; i++) put(i, c);
  } else if (legend.kind === 'categorical') {
    const col = table.columns[legend.field];
    const lookup = new Map<string, [number, number, number]>();
    for (const item of legend.items) lookup.set(item.label, hexToRgb(item.color));
    for (let i = 0; i < n; i++) {
      const v = col.kind === 'string' ? col.values[i] : null;
      put(i, (v !== null && lookup.get(v)) || neutral);
    }
  } else {
    const col = table.columns[legend.field];
    const stops = legend.stops;
    const scale = scaleLinear<string>()
      .domain(stops.map((_, i) => legend.min + ((legend.max - legend.min) * i) / (stops.length - 1)))
      .range(stops)
      .clamp(true);
    for (let i = 0; i < n; i++) {
      const v = col.kind === 'number' ? col.values[i] : NaN;
      put(i, Number.isFinite(v) ? hexToRgb(legend.max === legend.min ? stops[3] : scale(v)) : neutral);
    }
  }
  return { legend, rgb };
}

export interface SizeLegend {
  field: string;
  min: number;
  max: number;
  /** Radius multipliers (relative to base radius) at min and max. */
  rMin: number;
  rMax: number;
}

export const SIZE_RANGE: [number, number] = [0.45, 2.1];

/** Radius multipliers per row (1 = base radius). */
export function computeSizes(table: DataTable, field: string | null): { factors: Float32Array; legend: SizeLegend | null } {
  const n = table.rowCount;
  const factors = new Float32Array(n).fill(1);
  const meta = field ? table.fieldByName[field] : undefined;
  if (!field || !meta || meta.type !== 'quantitative' || meta.min === undefined || meta.max === undefined) {
    return { factors, legend: null };
  }
  const col = table.columns[field];
  if (col.kind !== 'number') return { factors, legend: null };
  const lo = meta.min >= 0 ? 0 : meta.min;
  const scale = scaleSqrt().domain([lo, meta.max]).range(SIZE_RANGE).clamp(true);
  for (let i = 0; i < n; i++) {
    const v = col.values[i];
    factors[i] = Number.isFinite(v) ? Math.max(SIZE_RANGE[0], scale(v)) : SIZE_RANGE[0] * 0.8;
  }
  return {
    factors,
    legend: { field, min: meta.min, max: meta.max, rMin: Math.max(SIZE_RANGE[0], scale(meta.min)), rMax: scale(meta.max) },
  };
}

/** Base bubble radius (world px) so visible bubbles fill a comfortable share of the plot area. */
export function baseRadius(visibleCount: number, plotWidth: number, plotHeight: number, meanFactor = 1): number {
  const area = Math.max(1, plotWidth * plotHeight);
  const r = Math.sqrt((area * 0.16) / (Math.max(1, visibleCount) * Math.PI)) / Math.sqrt(meanFactor);
  return Math.max(2, Math.min(18, r));
}
