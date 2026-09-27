import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './lasso';

describe('pointInPolygon', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  // A "C" shape: the notch (x 4–10, y 4–6) is outside.
  const cShape: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 4],
    [4, 4],
    [4, 6],
    [10, 6],
    [10, 10],
    [0, 10],
  ];

  it('handles convex polygons', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(11, 5, square)).toBe(false);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
  });

  it('handles concave polygons', () => {
    expect(pointInPolygon(2, 5, cShape)).toBe(true);
    expect(pointInPolygon(7, 5, cShape)).toBe(false);
    expect(pointInPolygon(7, 2, cShape)).toBe(true);
    expect(pointInPolygon(7, 8, cShape)).toBe(true);
  });

  it('works regardless of winding direction', () => {
    expect(pointInPolygon(5, 5, [...square].reverse())).toBe(true);
  });
});
