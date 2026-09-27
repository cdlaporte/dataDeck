import { bin, extent, mean, median } from 'd3-array';
import type {
  CategoryCount,
  Column,
  DataTable,
  Dataset,
  DateUnit,
  FieldMeta,
  FieldType,
  HistogramBin,
} from '../state/types';
import { isMissing, parseDate, parseNumber } from './parse';

const YEAR_NAME = /(^|[^a-z])(year|yr)s?([^a-z]|$)/i;

/** Guesses the variable type of a column from its raw string values. */
export function inferType(name: string, raw: string[]): FieldType {
  const present = raw.filter((v) => !isMissing(v)).map((v) => v.trim());
  if (present.length === 0) return 'text';

  let numeric = 0;
  let allInts = true;
  let min = Infinity;
  let max = -Infinity;
  const distinct = new Set<string>();
  for (const v of present) {
    distinct.add(v);
    const n = parseNumber(v);
    if (Number.isFinite(n)) {
      numeric++;
      if (!Number.isInteger(n)) allInts = false;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  if (numeric / present.length >= 0.95) {
    if (allInts && YEAR_NAME.test(name) && min >= 1000 && max <= 2200 && distinct.size > 4) return 'date';
    if (allInts && distinct.size <= 4) return 'categorical';
    return 'quantitative';
  }

  let dates = 0;
  for (const v of present) if (Number.isFinite(parseDate(v))) dates++;
  if (dates / present.length >= 0.9) return 'date';

  if (distinct.size <= 50 && (distinct.size <= 12 || distinct.size / present.length <= 0.5))
    return 'categorical';
  return 'text';
}

/** Converts a raw string to the numeric representation used for `type`. */
function toNumber(raw: string, type: 'quantitative' | 'date'): number {
  if (isMissing(raw)) return NaN;
  if (type === 'quantitative') return parseNumber(raw);
  const s = raw.trim();
  if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
  const d = parseDate(s);
  if (Number.isFinite(d)) return d;
  // A numeric column forced to date: treat values as epoch ms.
  return parseNumber(s);
}

export function buildColumn(raw: string[], type: FieldType): Column {
  if (type === 'quantitative' || type === 'date') {
    const values = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) values[i] = toNumber(raw[i], type);
    return { kind: 'number', values };
  }
  return { kind: 'string', values: raw.map((v) => (isMissing(v) ? null : v.trim())) };
}

function histogram(values: number[], lo: number, hi: number): HistogramBin[] {
  if (lo === hi) return [{ x0: lo, x1: hi, count: values.length }];
  return bin()
    .domain([lo, hi])
    .thresholds(20)(values)
    .map((b) => ({ x0: b.x0 ?? lo, x1: b.x1 ?? hi, count: b.length }));
}

function sortCategories(counts: Map<string, number>): CategoryCount[] {
  const list = [...counts].map(([value, count]) => ({ value, count }));
  const allNumeric = list.every((c) => Number.isFinite(parseNumber(c.value)));
  if (allNumeric) return list.sort((a, b) => parseNumber(a.value) - parseNumber(b.value));
  return list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function dateUnit(values: number[]): DateUnit {
  let unit: DateUnit = 'year';
  for (const v of values) {
    const d = new Date(v);
    if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) return 'time';
    if (d.getUTCMonth() !== 0 || d.getUTCDate() !== 1) unit = 'day';
  }
  return unit;
}

export function profileColumn(
  name: string,
  column: Column,
  inferredType: FieldType,
  type: FieldType,
): FieldMeta {
  const meta: FieldMeta = { name, inferredType, type, missing: 0, distinct: 0 };
  if (column.kind === 'number') {
    const present: number[] = [];
    for (const v of column.values) if (Number.isFinite(v)) present.push(v);
    meta.missing = column.values.length - present.length;
    meta.distinct = new Set(present).size;
    if (present.length) {
      const [lo, hi] = extent(present) as [number, number];
      meta.min = lo;
      meta.max = hi;
      meta.mean = mean(present);
      meta.median = median(present);
      meta.isInteger = present.every(Number.isInteger);
      meta.histogram = histogram(present, lo, hi);
      if (type === 'date') meta.dateUnit = dateUnit(present);
    }
  } else {
    const counts = new Map<string, number>();
    for (const v of column.values) {
      if (v === null) meta.missing++;
      else counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    meta.distinct = counts.size;
    meta.categories = sortCategories(counts);
  }
  return meta;
}

const LABEL_NAME = /(name|title|label)/i;

function pickLabelField(fields: FieldMeta[], rowCount: number): string | null {
  const candidates = fields.filter((f) => f.type === 'text' || f.type === 'categorical');
  const unique = candidates.filter((f) => f.distinct / Math.max(1, rowCount - f.missing) > 0.5);
  return (
    unique.find((f) => LABEL_NAME.test(f.name))?.name ??
    unique.find((f) => f.type === 'text')?.name ??
    candidates.find((f) => LABEL_NAME.test(f.name))?.name ??
    null
  );
}

/** Profiles every column of a dataset into a typed DataTable. */
export function buildTable(dataset: Dataset, overrides: Record<string, FieldType> = {}): DataTable {
  const fields: FieldMeta[] = [];
  const columns: Record<string, Column> = {};
  for (const name of dataset.columns) {
    const raw = dataset.rows.map((r) => r[name] ?? '');
    const inferred = inferType(name, raw);
    const type = overrides[name] ?? inferred;
    const column = buildColumn(raw, type);
    columns[name] = column;
    fields.push(profileColumn(name, column, inferred, type));
  }
  const fieldByName = Object.fromEntries(fields.map((f) => [f.name, f]));
  return {
    datasetId: dataset.id,
    rowCount: dataset.rows.length,
    fields,
    fieldByName,
    columns,
    labelField: pickLabelField(fields, dataset.rows.length),
  };
}

/** Fields usable as a layout / encoding dimension. */
export function isDimension(f: FieldMeta): boolean {
  return f.type !== 'text' && f.distinct > 0;
}

export function isNumericType(t: FieldType): t is 'quantitative' | 'date' {
  return t === 'quantitative' || t === 'date';
}
