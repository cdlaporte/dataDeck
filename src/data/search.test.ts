import { describe, expect, it } from 'vitest';
import { parseDelimited } from './parse';
import { buildTable } from './profile';
import { findRows } from './search';

const csv = [
  'Title,Genre,score',
  'Avatar,Action,1.5',
  'The Avatar Returns,Drama,2.5',
  'Avengers,Action,3.5',
  'Up,Animation,4.5',
  'Heat,Action,5.5',
  'Alien,Horror,6.5',
].join('\n');
const table = buildTable(parseDelimited(csv, 's'));

describe('findRows', () => {
  it('ranks label-field prefix matches first', () => {
    const { hits, total } = findRows(table, 'avatar');
    expect(total).toBe(2);
    expect(hits.map((h) => h.value)).toEqual(['Avatar', 'The Avatar Returns']);
  });

  it('searches categorical fields too', () => {
    const { hits, total } = findRows(table, 'horror');
    expect(total).toBe(1);
    expect(hits[0]).toMatchObject({ row: 5, field: 'Genre' });
  });

  it('limits hits but reports the total', () => {
    const { hits, total } = findRows(table, 'a', 2);
    expect(hits).toHaveLength(2);
    expect(total).toBe(6);
  });

  it('returns nothing for an empty query', () => {
    expect(findRows(table, '  ').total).toBe(0);
  });
});
