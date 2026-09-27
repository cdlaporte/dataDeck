import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDate, parseDelimited, parseNumber } from './parse';
import { buildTable, inferType } from './profile';
import { computeVisibility, countVisible } from './filters';

describe('parseNumber', () => {
  it('handles common numeric formats', () => {
    expect(parseNumber('12')).toBe(12);
    expect(parseNumber(' -3.5e2 ')).toBe(-350);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('$99')).toBe(99);
    expect(parseNumber('45%')).toBe(45);
    expect(parseNumber('.5')).toBe(0.5);
  });
  it('rejects non-numbers', () => {
    expect(parseNumber('12abc')).toBeNaN();
    expect(parseNumber('1,23')).toBeNaN();
    expect(parseNumber('2020-01-01')).toBeNaN();
  });
});

describe('parseDate', () => {
  it('parses ISO, slash and month-name dates as UTC', () => {
    expect(parseDate('2020-03-04')).toBe(Date.UTC(2020, 2, 4));
    expect(parseDate('2020-3-4')).toBe(Date.UTC(2020, 2, 4));
    expect(parseDate('2020-03')).toBe(Date.UTC(2020, 2, 1));
    expect(parseDate('Jun 12 1998')).toBe(Date.UTC(1998, 5, 12));
    expect(parseDate('03/04/2020')).toBe(Date.UTC(2020, 2, 4));
    expect(parseDate('2020-03-04T10:00:00Z')).toBe(Date.UTC(2020, 2, 4, 10));
  });
  it('does not treat plain numbers as dates', () => {
    expect(parseDate('1998')).toBeNaN();
    expect(parseDate('42')).toBeNaN();
    expect(parseDate('hello')).toBeNaN();
  });
});

describe('inferType', () => {
  it('detects quantitative columns, tolerating missing values', () => {
    expect(inferType('mass', ['1.5', '2', 'NA', '', '3.25'])).toBe('quantitative');
  });
  it('treats low-cardinality integers as categorical', () => {
    expect(inferType('year', ['2007', '2008', '2009', '2008'])).toBe('categorical');
    expect(inferType('flag', ['0', '1', '1', '0', '1'])).toBe('categorical');
  });
  it('treats integer year columns as dates', () => {
    const years = Array.from({ length: 30 }, (_, i) => String(1970 + (i % 12)));
    expect(inferType('Year', years)).toBe('date');
    expect(inferType('Weight', years)).toBe('quantitative');
  });
  it('detects dates in mixed formats', () => {
    expect(inferType('when', ['2020-01-01', '2020-02-15', 'NA', '2021-12-31'])).toBe('date');
    expect(inferType('Release Date', ['Jun 12 1998', 'Sep 08 2006', 'Jan 01 2010'])).toBe('date');
  });
  it('separates categorical from free text / ids', () => {
    const cats = Array.from({ length: 100 }, (_, i) => ['a', 'b', 'c'][i % 3]);
    expect(inferType('group', cats)).toBe('categorical');
    const ids = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    expect(inferType('id', ids)).toBe('text');
  });
  it('treats numeric ids as quantitative (overridable by the user)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => String(1000 + i));
    expect(inferType('id', ids)).toBe('quantitative');
  });
  it('returns text for empty columns', () => {
    expect(inferType('empty', ['', 'NA', ''])).toBe('text');
  });
});

describe('buildTable', () => {
  const csv = 'name,species,mass,when\nA,x,1.5,2020-01-01\nB,y,2,2020-01-02\nC,x,NA,2020-01-03\nD,y,4,\n';
  const table = buildTable(parseDelimited(csv, 'test'));

  it('profiles stats and missing values', () => {
    const mass = table.fieldByName.mass;
    expect(mass.type).toBe('quantitative');
    expect(mass.missing).toBe(1);
    expect(mass.min).toBe(1.5);
    expect(mass.max).toBe(4);
    expect(mass.histogram?.reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(table.fieldByName.species.categories).toEqual([
      { value: 'x', count: 2 },
      { value: 'y', count: 2 },
    ]);
    expect(table.fieldByName.when.type).toBe('date');
    expect(table.fieldByName.when.missing).toBe(1);
  });

  it('applies type overrides', () => {
    const t = buildTable(parseDelimited(csv, 'test'), { mass: 'categorical' });
    expect(t.fieldByName.mass.type).toBe('categorical');
    expect(t.fieldByName.mass.inferredType).toBe('quantitative');
    expect(t.columns.mass.kind).toBe('string');
  });

  it('picks a label field', () => {
    expect(table.labelField).toBe('name');
  });

  it('filters with AND semantics', () => {
    const vis = computeVisibility(table, [
      { id: '1', kind: 'categorical', field: 'species', exclude: ['y'] },
      { id: '2', kind: 'range', field: 'mass', min: 0, max: 10 },
    ]);
    expect([...vis]).toEqual([1, 0, 0, 0]);
    expect(countVisible(vis)).toBe(1);
  });
});

describe('bundled samples', () => {
  const load = (f: string) => buildTable(parseDelimited(readFileSync(`public/samples/${f}`, 'utf8'), f));
  it('types the movies dataset sensibly', () => {
    const t = load('movies.csv');
    expect(t.rowCount).toBe(3201);
    expect(t.fieldByName['Release Date'].type).toBe('date');
    expect(t.fieldByName['IMDB Rating'].type).toBe('quantitative');
    expect(t.fieldByName['Major Genre'].type).toBe('categorical');
    expect(t.fieldByName['Title'].type).toBe('text');
    expect(t.labelField).toBe('Title');
  });
  it('types cars and penguins sensibly', () => {
    const cars = load('cars.csv');
    expect(cars.fieldByName.Year.type).toBe('date');
    expect(cars.fieldByName.Origin.type).toBe('categorical');
    expect(cars.labelField).toBe('Name');
    const p = load('penguins.csv');
    expect(p.fieldByName.species.type).toBe('categorical');
    expect(p.fieldByName.body_mass_g.type).toBe('quantitative');
    expect(p.fieldByName.year.type).toBe('categorical');
  });
});
