import { describe, expect, it } from 'vitest';
import { fitFrame } from './frame';

describe('fitFrame', () => {
  it('letterboxes a narrower frame in a wide box', () => {
    const f = fitFrame({ width: 800, height: 600 }, { width: 1600, height: 900 });
    expect(f.scale).toBe(1.5);
    expect(f.x).toBe(200);
    expect(f.y).toBe(0);
  });

  it('pillarboxes a wider frame in a tall box', () => {
    const f = fitFrame({ width: 1000, height: 500 }, { width: 1000, height: 800 });
    expect(f.scale).toBe(1);
    expect(f.x).toBe(0);
    expect(f.y).toBe(150);
  });

  it('fills an identical box exactly and survives empty sizes', () => {
    expect(fitFrame({ width: 640, height: 480 }, { width: 640, height: 480 })).toEqual({
      scale: 1,
      x: 0,
      y: 0,
    });
    expect(fitFrame({ width: 0, height: 0 }, { width: 640, height: 480 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
