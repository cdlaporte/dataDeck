import {
  forceCollide,
  forceSimulation,
  type Simulation as D3Simulation,
  type SimulationNodeDatum,
} from 'd3-force';

export interface SimNode extends SimulationNodeDatum {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Resting alpha: keeps the simulation gently alive instead of freezing. */
const ALPHA_TARGET = 0.08;

/**
 * One persistent d3-force simulation for the whole session. Views never
 * rebuild it: they swap per-node targets, strengths and collision radii and
 * reheat, so bubbles always travel from where they are to where they belong.
 * The simulation is ticked manually from the engine's render loop.
 */
export class Simulation {
  readonly nodes: SimNode[] = [];
  private sim: D3Simulation<SimNode, undefined>;
  private tx: Float32Array = new Float32Array(0);
  private ty: Float32Array = new Float32Array(0);
  private collideR: Float32Array = new Float32Array(0);
  private strengthX = 0.08;
  private strengthY = 0.08;
  private collide = forceCollide<SimNode>().iterations(2);

  constructor() {
    this.sim = forceSimulation<SimNode>([])
      .stop()
      .velocityDecay(0.32)
      .alphaDecay(0.018)
      .alphaTarget(ALPHA_TARGET)
      .force('target', (alpha: number) => this.targetForce(alpha))
      .force('collide', this.collide);
  }

  /** Replaces the node set, seeding positions in a phyllotaxis disc around (cx, cy). */
  setCount(n: number, cx: number, cy: number, spacing = 4) {
    this.nodes.length = 0;
    for (let i = 0; i < n; i++) {
      const r = spacing * Math.sqrt(0.5 + i);
      const a = i * Math.PI * (3 - Math.sqrt(5));
      this.nodes.push({ index: i, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), vx: 0, vy: 0 });
    }
    this.tx = new Float32Array(n).fill(cx);
    this.ty = new Float32Array(n).fill(cy);
    this.collideR = new Float32Array(n);
    this.sim.nodes(this.nodes);
    this.collide.radius((d) => this.collideR[d.index]);
  }

  /** Updates targets (NaN entries keep the previous target). */
  setTargets(tx: Float32Array, ty: Float32Array, strengthX: number, strengthY: number) {
    for (let i = 0; i < this.tx.length; i++) {
      if (Number.isFinite(tx[i])) this.tx[i] = tx[i];
      if (Number.isFinite(ty[i])) this.ty[i] = ty[i];
    }
    this.strengthX = strengthX;
    this.strengthY = strengthY;
  }

  setCollision(radii: Float32Array, strength: number) {
    this.collideR = radii;
    this.collide.strength(strength).radius((d) => this.collideR[d.index]);
  }

  reheat(alpha = 0.9) {
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
  }

  get alpha() {
    return this.sim.alpha();
  }

  tick() {
    if (this.nodes.length) this.sim.tick();
  }

  /** Translates every node and target (used when the viewport resizes). */
  translate(dx: number, dy: number) {
    for (const n of this.nodes) {
      n.x += dx;
      n.y += dy;
    }
    for (let i = 0; i < this.tx.length; i++) {
      this.tx[i] += dx;
      this.ty[i] += dy;
    }
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
}
