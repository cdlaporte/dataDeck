import type { Frame } from '../state/types';

/** Uniform scale and centring offset that fit `frame` inside `box` (letterboxed). */
export function fitFrame(frame: Frame, box: Frame): { scale: number; x: number; y: number } {
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  if (!Number.isFinite(scale) || scale <= 0) return { scale: 1, x: 0, y: 0 };
  return {
    scale,
    x: (box.width - frame.width * scale) / 2,
    y: (box.height - frame.height * scale) / 2,
  };
}
