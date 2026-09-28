import type { Frame } from '../state/types';

export const NOTE_SCALE_MIN = 0.4;
export const NOTE_SCALE_MAX = 3;

/**
 * How much a note authored on a `frame`-sized stage is scaled on a `stage`-sized
 * one: the uniform fit (same rule as presenting a slide), clamped. Notes without
 * a frame keep fixed pixels.
 */
export function noteScale(frame: Frame | undefined, stage: Frame): number {
  if (!frame || frame.width <= 0 || frame.height <= 0) return 1;
  const s = Math.min(stage.width / frame.width, stage.height / frame.height);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(NOTE_SCALE_MAX, Math.max(NOTE_SCALE_MIN, s));
}
