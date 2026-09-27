import type { DataTable, Filter } from '../state/types';

/** Returns a 0/1 mask of rows that pass every filter (filters combine with AND). */
export function computeVisibility(table: DataTable, filters: Filter[]): Uint8Array {
  const n = table.rowCount;
  const visible = new Uint8Array(n).fill(1);
  for (const f of filters) {
    if (f.kind === 'rows') {
      if (f.mode === 'include') {
        const keep = new Uint8Array(n);
        for (const r of f.rows) if (r >= 0 && r < n) keep[r] = 1;
        for (let i = 0; i < n; i++) visible[i] &= keep[i];
      } else {
        for (const r of f.rows) if (r >= 0 && r < n) visible[r] = 0;
      }
      continue;
    }
    const col = table.columns[f.field];
    if (!col) continue;
    if (f.kind === 'categorical' && col.kind === 'string') {
      if (f.exclude.length === 0) continue;
      const excluded = new Set(f.exclude);
      for (let i = 0; i < n; i++) {
        const v = col.values[i];
        if (excluded.has(v ?? MISSING_KEY)) visible[i] = 0;
      }
    } else if (f.kind === 'range' && col.kind === 'number') {
      for (let i = 0; i < n; i++) {
        const v = col.values[i];
        if (!(v >= f.min && v <= f.max)) visible[i] = 0;
      }
    }
  }
  return visible;
}

/** Category key used for missing values in categorical filters and groupings. */
export const MISSING_KEY = '∅ (missing)';

export function countVisible(mask: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i];
  return c;
}
