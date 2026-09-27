import { format } from 'd3-format';
import { utcFormat } from 'd3-time-format';
import type { DataTable, DateUnit, FieldMeta } from '../state/types';

const compact = format('~s');
const fixed2 = format(',.2~f');
const int = format(',d');
const dayFmt = utcFormat('%b %-d, %Y');
const yearFmt = utcFormat('%Y');
const timeFmt = utcFormat('%b %-d, %Y %H:%M');

export function formatNumber(v: number, meta?: FieldMeta): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return compact(v).replace('G', 'B');
  if (meta?.isInteger || Number.isInteger(v)) return int(v);
  return fixed2(v);
}

export function formatDate(v: number, unit: DateUnit = 'day'): string {
  if (!Number.isFinite(v)) return '—';
  const d = new Date(v);
  return unit === 'year' ? yearFmt(d) : unit === 'time' ? timeFmt(d) : dayFmt(d);
}

/** Human-readable value of `field` for row `i`. */
export function formatCell(table: DataTable, field: string, i: number): string {
  const col = table.columns[field];
  const meta = table.fieldByName[field];
  if (!col || !meta) return '';
  if (col.kind === 'string') return col.values[i] ?? '—';
  return meta.type === 'date' ? formatDate(col.values[i], meta.dateUnit) : formatNumber(col.values[i], meta);
}

export function rowLabel(table: DataTable, i: number): string {
  return table.labelField ? formatCell(table, table.labelField, i) : `Row ${i + 1}`;
}
