import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../data/parse';
import { MISSING_KEY } from '../data/filters';
import { buildTable } from '../data/profile';
import { colorLegend, computeColors } from './encodings';
import { CATEGORICAL, NEUTRAL } from './palette';

const csv = ['name,kind', 'a,cat', 'b,dog', 'c,', 'd,cat', 'e,bird'].join('\n');
const table = buildTable(parseDelimited(csv, 'c'), { kind: 'categorical' });

describe('custom category colours', () => {
  it('replace palette colours for the chosen categories only', () => {
    const legend = colorLegend(table, 'kind', 'light', { kind: { dog: '#ff0000' } });
    if (legend.kind !== 'categorical') throw new Error('expected categorical');
    const byLabel = Object.fromEntries(legend.items.map((i) => [i.label, i]));
    expect(byLabel.dog).toMatchObject({ color: '#ff0000', custom: true });
    expect(byLabel.cat.custom).toBe(false);
    expect(CATEGORICAL.light).toContain(byLabel.cat.color);
  });

  it('colour the bubbles, including missing values', () => {
    const { rgb } = computeColors(table, { color: 'kind', size: null }, 'light', {
      kind: { dog: '#ff0000', [MISSING_KEY]: '#0000ff' },
    });
    expect(Array.from(rgb.slice(3, 6))).toEqual([1, 0, 0]); // b: dog
    expect(Array.from(rgb.slice(6, 9))).toEqual([0, 0, 1]); // c: missing
    const plain = computeColors(table, { color: 'kind', size: null }, 'light');
    const neutral = parseInt(NEUTRAL.light.slice(1, 3), 16) / 255;
    expect(plain.rgb[6]).toBeCloseTo(neutral);
  });
});
