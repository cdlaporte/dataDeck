// Motion presets: how quickly views transition and how "alive" the resting layout is.

export type MotionPreset = 'calm' | 'balanced' | 'lively';

export interface MotionParams {
  /** How long targets take to glide from the old layout to the new one. */
  transitionMs: number;
  /** Fraction of velocity lost per tick (higher = more damping). */
  velocityDecay: number;
  /** Resting alpha: the sim never fully stops, but at rest forces are faint. */
  restAlpha: number;
  /** Alpha decay per tick after a reheat. */
  alphaDecay: number;
  /** Speed limit in world px per tick, so nothing is ever flung. */
  maxSpeed: number;
  /** Camera tween duration between slides. */
  cameraMs: number;
  /** Time constant for radius / colour tweens. */
  tweenMs: number;
}

export const MOTION: Record<MotionPreset, MotionParams> = {
  calm: {
    transitionMs: 1600,
    velocityDecay: 0.55,
    restAlpha: 0.02,
    alphaDecay: 0.03,
    maxSpeed: 5,
    cameraMs: 1400,
    tweenMs: 320,
  },
  balanced: {
    transitionMs: 1000,
    velocityDecay: 0.45,
    restAlpha: 0.03,
    alphaDecay: 0.025,
    maxSpeed: 9,
    cameraMs: 1000,
    tweenMs: 220,
  },
  lively: {
    transitionMs: 650,
    velocityDecay: 0.35,
    restAlpha: 0.05,
    alphaDecay: 0.02,
    maxSpeed: 15,
    cameraMs: 700,
    tweenMs: 150,
  },
};

export const MOTION_LABEL: Record<MotionPreset, string> = {
  calm: 'Calm',
  balanced: 'Balanced',
  lively: 'Lively',
};

/** Simulation ticks per second, independent of display refresh rate. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Fixed-timestep accumulator: converts elapsed wall time into a whole number of
 * simulation ticks, so motion runs at the same speed at 60 Hz and 120 Hz.
 */
export class TickClock {
  private acc = 0;
  private last = -1;

  /** Returns how many ticks to run for a frame at time `now` (ms). */
  advance(now: number, maxTicks = 3): number {
    if (this.last < 0) {
      this.last = now;
      return 1;
    }
    let dt = now - this.last;
    this.last = now;
    // After a hidden tab or a long stall, resume smoothly instead of catching up.
    if (dt > 250) dt = TICK_MS;
    this.acc += dt;
    let ticks = Math.floor(this.acc / TICK_MS);
    this.acc -= ticks * TICK_MS;
    if (ticks > maxTicks) {
      ticks = maxTicks;
      this.acc = 0;
    }
    return ticks;
  }
}
