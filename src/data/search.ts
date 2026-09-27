import type { DataTable } from '../state/types';

export interface SearchHit {
  row: number;
  field: string;
  value: string;
}

/**
 * Finds rows whose text/categorical values contain `query` (case-insensitive).
 * The label field is searched first; prefix matches rank above substring matches.
 * Returns up to `limit` hits and the total number of matching rows.
 */
export function findRows(
  table: DataTable,
  query: string,
  limit = 8,
  /** Only search rows with mask[i] = 1 (e.g. rows that pass the filters). */
  mask?: Uint8Array,
): { hits: SearchHit[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], total: 0 };
  const fields = table.fields
    .filter((f) => f.type === 'text' || f.type === 'categorical')
    .map((f) => f.name)
    .sort((a, b) => Number(b === table.labelField) - Number(a === table.labelField));
  const best = new Map<number, { hit: SearchHit; rank: number }>();
  fields.forEach((field, fi) => {
    const col = table.columns[field];
    if (col.kind !== 'string') return;
    for (let i = 0; i < table.rowCount; i++) {
      if (mask && !mask[i]) continue;
      const v = col.values[i];
      if (!v) continue;
      const pos = v.toLowerCase().indexOf(q);
      if (pos < 0) continue;
      // Lower rank = better: label field first, then prefix matches, then shorter values.
      const rank = fi * 10 + (pos === 0 ? 0 : 5);
      const prev = best.get(i);
      if (!prev || rank < prev.rank) best.set(i, { hit: { row: i, field, value: v }, rank });
    }
  });
  const sorted = [...best.values()].sort(
    (a, b) => a.rank - b.rank || a.hit.value.length - b.hit.value.length || a.hit.row - b.hit.row,
  );
  return { hits: sorted.slice(0, limit).map((b) => b.hit), total: sorted.length };
}
