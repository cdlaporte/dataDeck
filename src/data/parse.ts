import Papa from 'papaparse';
import type { Dataset } from '../state/types';

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '-', '?', '#n/a', 'undefined']);

export function isMissing(raw: string | null | undefined): boolean {
  return raw == null || MISSING.has(raw.trim().toLowerCase());
}

const THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/** Parses numbers like "12", "-3.5e2", "1,234.5", "$99", "45%". Returns NaN otherwise. */
export function parseNumber(raw: string): number {
  let s = raw.trim();
  if (s.startsWith('$') || s.startsWith('€') || s.startsWith('£')) s = s.slice(1);
  else if (s.startsWith('-$')) s = '-' + s.slice(2);
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (THOUSANDS.test(s)) s = s.replace(/,/g, '');
  if (!NUMBER.test(s)) return NaN;
  return Number(s);
}

const ISO_DATE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const SLASH_DATE =
  /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})(\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?)?$/i;
const MONTH_NAME = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/i;

/** Parses a date-like string to UTC epoch ms, or NaN. Plain numbers are not dates. */
export function parseDate(raw: string): number {
  const s = raw.trim();
  if (ISO_DATE.test(s)) {
    const [datePart] = s.split(/[T ]/);
    if (datePart.split('-').length === 2) return Date.parse(`${datePart}-01T00:00:00Z`);
    if (datePart === s) return Date.parse(`${normaliseIsoDate(datePart)}T00:00:00Z`);
    return Date.parse(s.replace(' ', 'T'));
  }
  if (!SLASH_DATE.test(s) && !(MONTH_NAME.test(s) && /\d{4}/.test(s))) return NaN;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return NaN;
  // Non-ISO strings parse as local time; re-express the wall-clock time as UTC.
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}

function normaliseIsoDate(s: string): string {
  const [y, m, d] = s.split('-');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export class ParseError extends Error {}

/** Parses CSV/TSV text (delimiter auto-detected) into a Dataset. */
export function parseDelimited(text: string, name: string, source: Dataset['source'] = 'upload'): Dataset {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (h, i) => h.trim() || `column_${i + 1}`,
  });
  const columns = dedupe(result.meta.fields ?? []);
  if (columns.length === 0) throw new ParseError('No columns found. Is the first row a header?');
  const rows = result.data.map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = r[c] == null ? '' : String(r[c]);
    return out;
  });
  if (rows.length === 0) throw new ParseError('The file has a header but no data rows.');
  return { id: makeId(), name, source, columns, rows };
}

function dedupe(cols: string[]): string[] {
  const seen = new Map<string, number>();
  return cols.map((c) => {
    const n = seen.get(c) ?? 0;
    seen.set(c, n + 1);
    return n === 0 ? c : `${c}_${n + 1}`;
  });
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
