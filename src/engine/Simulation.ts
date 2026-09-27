import { forceSimulation, type Simulation as D3Simulation, type SimulationNodeDatum } from 'd3-force';
import { GridCollide } from './collide';
import { MOTION, TICK_MS, easeInOutCubic, type MotionParams } from './motion';

export interface SimNode extends SimulationNodeDatum {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * One persistent d3-force simulation for the whole session. Views never
 * rebuild it: they hand over new per-node targets, strengths and collision
 * radii. Targets glide from the old layout to the new one (eased), a speed
 * limit keeps motion smooth, and alpha decays to a small resting value so
 * clusters come to rest instead of churning. Ticked at a fixed rate by the engine.
 */
export class Simulation {
  readonly nodes: SimNode[] = [];
  private sim: D3Simulation<SimNode, undefined>;
  private collideR: Float32Array = new Float32Array(0);
  private strengthX = 0.08;
  private strengthY = 0.08;
  private collideStrength = 1;
  private collide = new GridCollide();
  private motion: MotionParams = MOTION.balanced;

  /** Current (interpolated) targets, and the transition they are gliding along. */
  private tx: Float32Array = new Float32Array(0);
  private ty: Float32Array = new Float32Array(0);
  private fromX: Float32Array = new Float32Array(0);
  private fromY: Float32Array = new Float32Array(0);
  private toX: Float32Array = new Float32Array(0);
  private toY: Float32Array = new Float32Array(0);
  private transitionTick = 0;
  private transitionTicks = 0;
  /** Alpha held while targets are moving, so bubbles keep up with them. */
  private holdAlpha = 0;

  constructor() {
    this.sim = forceSimulation<SimNode>([])
      .stop()
      .force('target', (alpha: number) => this.targetForce(alpha))
      .force('collide', () => this.collide.apply(this.nodes, this.collideR, this.collideStrength, 3))
      .force('limit', () => this.limitSpeed());
    this.setMotion(this.motion);
  }

  setMotion(motion: MotionParams) {
    this.motion = motion;
    this.sim.velocityDecay(motion.velocityDecay).alphaDecay(motion.alphaDecay).alphaTarget(motion.restAlpha);
  }

  /** Replaces the node set, seeding positions in a phyllotaxis disc around (cx, cy). */
  setCount(n: number, cx: number, cy: number, spacing = 4) {
    this.nodes.length = 0;
    for (let i = 0; i < n; i++) {
      const r = spacing * Math.sqrt(0.5 + i);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      this.nodes.push({ index: i, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), vx: 0, vy: 0 });
    }
    const filled = () => new Float32Array(n);
    this.tx = filled().fill(cx);
    this.ty = filled().fill(cy);
    this.fromX = this.tx.slice();
    this.fromY = this.ty.slice();
    this.toX = this.tx.slice();
    this.toY = this.ty.slice();
    this.transitionTicks = 0;
    this.collideR = filled();
    this.sim.nodes(this.nodes);
  }

  /**
   * Sets new targets (NaN entries keep the previous target). Targets ease from
   * where they are now to the new positions over `durationMs` (default: the
   * motion preset's transition time; 0 = jump).
   */
  setTargets(
    tx: Float32Array,
    ty: Float32Array,
    strengthX: number,
    strengthY: number,
    durationMs = this.motion.transitionMs,
  ) {
    for (let i = 0; i < this.tx.length; i++) {
      this.fromX[i] = this.tx[i];
      this.fromY[i] = this.ty[i];
      if (Number.isFinite(tx[i])) this.toX[i] = tx[i];
      if (Number.isFinite(ty[i])) this.toY[i] = ty[i];
    }
    this.transitionTick = 0;
    this.transitionTicks = Math.max(0, Math.round(durationMs / TICK_MS));
    if (this.transitionTicks === 0) {
      this.tx.set(this.toX);
      this.ty.set(this.toY);
    }
    this.strengthX = strengthX;
    this.strengthY = strengthY;
  }

  setCollision(radii: Float32Array, strength: number) {
    this.collideR = radii;
    this.collideStrength = strength;
  }

  /** Raises alpha to at least `alpha`, and holds it there while targets are moving. */
  reheat(alpha = 0.6) {
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
    this.holdAlpha = alpha;
  }

  get alpha() {
    return this.sim.alpha();
  }

  get transitioning() {
    return this.transitionTick < this.transitionTicks;
  }

  /** Sum of squared node speeds (for tests and settle detection). */
  kineticEnergy(): number {
    let e = 0;
    for (const n of this.nodes) e += n.vx * n.vx + n.vy * n.vy;
    return e;
  }

  tick() {
    if (!this.nodes.length) return;
    if (this.transitionTick < this.transitionTicks) {
      this.transitionTick++;
      const e = easeInOutCubic(this.transitionTick / this.transitionTicks);
      const { fromX, fromY, toX, toY, tx, ty } = this;
      for (let i = 0; i < tx.length; i++) {
        tx[i] = fromX[i] + (toX[i] - fromX[i]) * e;
        ty[i] = fromY[i] + (toY[i] - fromY[i]) * e;
      }
      if (this.sim.alpha() < this.holdAlpha) this.sim.alpha(this.holdAlpha);
    }
    this.sim.tick();
  }

  /** Translates every node and target (used when the viewport resizes). */
  translate(dx: number, dy: number) {
    for (const n of this.nodes) {
      n.x += dx;
      n.y += dy;
    }
    for (const arr of [this.tx, this.fromX, this.toX]) for (let i = 0; i < arr.length; i++) arr[i] += dx;
    for (const arr of [this.ty, this.fromY, this.toY]) for (let i = 0; i < arr.length; i++) arr[i] += dy;
  }

  private targetForce(alpha: number) {
    const sx = this.strengthX * alpha;
    const sy = this.strengthY * alpha;
    const { tx, ty } = this;
    for (const node of this.nodes) {
      node.vx += (tx[node.index] - node.x) * sx;
      node.vy += (ty[node.index] - node.y) * sy;
    }
  }

  /** Caps per-tick displacement (d3 applies velocity decay after the forces). */
  private limitSpeed() {
    const max = this.motion.maxSpeed / (1 - this.motion.velocityDecay);
    const max2 = max * max;
    for (const node of this.nodes) {
      const s2 = node.vx * node.vx + node.vy * node.vy;
      if (s2 > max2) {
        const k = max / Math.sqrt(s2);
        node.vx *= k;
        node.vy *= k;
      }
    }
  }
}
