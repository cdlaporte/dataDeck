import { describe, expect, it } from 'vitest';
import { NOTE_SCALE_MAX, NOTE_SCALE_MIN, noteScale } from './noteScale';

describe('noteScale', () => {
  const frame = { width: 1000, height: 600 };
  it('is 1 at the authoring size and without a frame', () => {
    expect(noteScale(frame, { width: 1000, height: 600 })).toBe(1);
    expect(noteScale(undefined, { width: 400, height: 300 })).toBe(1);
  });
  it('follows the tighter dimension', () => {
    expect(noteScale(frame, { width: 500, height: 600 })).toBe(0.5);
    expect(noteScale(frame, { width: 2000, height: 900 })).toBe(1.5);
  });
  it('is clamped', () => {
    expect(noteScale(frame, { width: 100, height: 60 })).toBe(NOTE_SCALE_MIN);
    expect(noteScale(frame, { width: 10000, height: 6000 })).toBe(NOTE_SCALE_MAX);
  });
});
