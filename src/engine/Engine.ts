import { quadtree, type Quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { computeVisibility } from '../data/filters';
import { Overlay, type AnnotationPlacement, type GroupLabel } from '../overlay/Overlay';
import type { CameraState, DataTable, LayoutSpec, ViewState } from '../state/types';
import { baseRadius, computeColors, computeSizes, type ColorLegend, type SizeLegend } from './encodings';
import { computeLayout, type LayoutResult } from './layouts';
import { plotRect } from './layouts/common';
import type { ThemeColors } from './palette';
import { Renderer, type Transform } from './Renderer';
import { Simulation } from './Simulation';
import { buildTsneInput } from './tsne';
import type { TsneRequest, TsneResponse } from './tsne.worker';

export type Tool = 'select' | 'annotate';

export interface LayoutInfo {
  message?: string;
  visibleCount: number;
  totalCount: number;
  colorLegend: ColorLegend;
  sizeLegend: SizeLegend | null;
  /** On-screen radius of a size-factor-1 bubble, for the size legend. */
  baseRadiusPx: number;
}

export interface TsneStatus {
  state: 'idle' | 'preparing' | 'running' | 'paused' | 'done' | 'error';
  iteration: number;
  total: number;
  message?: string;
}

export interface HoverInfo {
  row: number;
  clientX: number;
  clientY: number;
}

export interface ClickInfo {
  row: number | null;
  /** Normalised viewport position of the click in world space. */
  nx: number;
  ny: number;
  clientX: number;
  clientY: number;
}

export interface EngineCallbacks {
  onHover?(info: HoverInfo | null): void;
  onClick?(info: ClickInfo): void;
  onCameraChange?(camera: CameraState): void;
  onLayoutInfo?(info: LayoutInfo): void;
  onTsneStatus?(status: TsneStatus): void;
  onTsneDone?(coords: (number | null)[]): void;
  onAnnotationMove?(id: string, dx: number, dy: number): void;
  onAnnotationEdit?(id: string): void;
  onGroupClick?(field: string, value: string): void;
}

const CAMERA_TWEEN_MS = 900;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Framework-free orchestrator: owns the WebGL renderer, the persistent force
 * simulation, the SVG overlay, the camera and the t-SNE worker. React talks
 * to it through setTable / setView / setTheme and callbacks.
 */
export class Engine {
  readonly canvas: HTMLCanvasElement;
  readonly svg: SVGSVGElement;
  private renderer: Renderer;
  private sim = new Simulation();
  private overlay: Overlay;
  private zoomBehavior: ZoomBehavior<HTMLElement, unknown>;
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private width = 1;
  private height = 1;
  private transform: Transform = { k: 1, x: 0, y: 0 };
  private cameraTween: { from: CameraState; to: CameraState; start: number } | null = null;
  private suppressCameraEvents = false;
  private suppressClick = false;

  private table: DataTable | null = null;
  private view: ViewState | null = null;
  private theme: ThemeColors | null = null;
  private tool: Tool = 'select';
  private layout: LayoutResult | null = null;

  // Per-row state.
  private visible = new Uint8Array(0);
  private targetR = new Float32Array(0);
  private displayR = new Float32Array(0);
  private targetRGBA = new Float32Array(0);
  private displayRGBA = new Float32Array(0);
  private hovered = -1;
  private animating = true;

  private tree: Quadtree<number> | null = null;
  private treeFrame = -1;
  private frameCount = 0;
  private maxR = 1;

  // t-SNE
  private worker: Worker | null = null;
  private tsneRunId = 0;
  private tsneKey = '';
  private tsneNonce = 0;
  private tsneRows: number[] = [];
  private tsneCoords: Float32Array | null = null;
  private storedCoordsRef: (number | null)[] | undefined;
  private storedCoords: Float32Array | null = null;
  private tsneStatus: TsneStatus = { state: 'idle', iteration: 0, total: 0 };

  frameTime = 0;

  constructor(
    readonly container: HTMLElement,
    private callbacks: EngineCallbacks = {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'stage-overlay');
    container.append(this.canvas, this.svg);

    this.renderer = new Renderer(this.canvas);
    this.overlay = new Overlay(this.svg, {
      onAnnotationMove: (id, dx, dy, done) => done && this.callbacks.onAnnotationMove?.(id, dx, dy),
      onAnnotationEdit: (id) => this.callbacks.onAnnotationEdit?.(id),
      onGroupClick: (key) => {
        const field = this.layout?.groups?.field;
        if (field && this.tool === 'annotate') this.callbacks.onGroupClick?.(field, key);
      },
    });

    this.zoomBehavior = d3zoom<HTMLElement, unknown>()
      .scaleExtent([0.25, 16])
      .filter((e: Event) => {
        const target = e.target as Element | null;
        if (target?.closest?.('.annotation-note')) return false;
        const me = e as MouseEvent;
        // Pressing on a bubble drags the bubble instead of panning.
        if ((e.type === 'mousedown' || e.type === 'touchstart') && this.tool === 'select' && this.dragHit(e))
          return false;
        return (!me.ctrlKey || e.type === 'wheel') && !me.button;
      })
      .on('zoom', (e: D3ZoomEvent<HTMLElement, unknown>) => {
        this.transform = { k: e.transform.k, x: e.transform.x, y: e.transform.y };
        if (e.sourceEvent) this.cameraTween = null;
      })
      .on('end', (e: D3ZoomEvent<HTMLElement, unknown>) => {
        if (e.sourceEvent && !this.suppressCameraEvents) this.callbacks.onCameraChange?.(this.cameraState());
      });
    select(container).call(this.zoomBehavior).on('dblclick.zoom', null);

    container.addEventListener('pointerdown', this.handlePointerDown);
    container.addEventListener('pointermove', this.handlePointerMove);
    container.addEventListener('pointerleave', this.handlePointerLeave);
    container.addEventListener('click', this.handleClick, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------------------
  // Public API

  setTheme(theme: ThemeColors) {
    this.theme = theme;
    this.renderer.setTheme(theme.surface, theme.textPrimary);
    this.overlay.setTheme(theme);
    this.recompute(false);
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.overlay.interactive = tool === 'annotate';
    this.container.classList.toggle('tool-annotate', tool === 'annotate');
  }

  /** Sets the data (and optionally the view that goes with it, applied atomically). */
  setTable(table: DataTable | null, view?: ViewState) {
    const prev = this.table;
    this.table = table;
    if (view) this.view = view;
    const n = table?.rowCount ?? 0;
    const sameRows = prev && table && prev.datasetId === table.datasetId && prev.rowCount === n;
    if (!sameRows) {
      this.stopTsne();
      this.tsneKey = '';
      this.storedCoordsRef = undefined;
      const rect = plotRect({ width: this.width, height: this.height });
      this.sim.setCount(n, rect.cx, rect.cy, 3);
      this.renderer.ensureCapacity(n);
      this.visible = new Uint8Array(n);
      this.targetR = new Float32Array(n);
      this.displayR = new Float32Array(n);
      this.targetRGBA = new Float32Array(n * 4);
      this.displayRGBA = new Float32Array(n * 4);
      this.hovered = -1;
      this.recompute(true);
      this.displayRGBA.set(this.targetRGBA);
      for (let i = 0; i < n; i++) this.displayRGBA[i * 4 + 3] = 0;
    } else {
      this.recompute(true);
    }
    if (view) this.applyCamera(view.camera);
  }

  setView(view: ViewState, opts: { animateCamera?: boolean } = {}) {
    const prev = this.view;
    this.view = view;
    // Title / caption / annotation / camera edits don't touch the layout.
    if (!prev || !sameLayoutInputs(prev, view)) this.recompute(true);
    const current = this.cameraState();
    const c = view.camera;
    if (
      Math.abs(c.cx - current.cx) > 1e-4 ||
      Math.abs(c.cy - current.cy) > 1e-4 ||
      Math.abs(c.k - current.k) > 1e-4
    ) {
      if (opts.animateCamera) this.cameraTween = { from: current, to: { ...c }, start: performance.now() };
      else this.applyCamera(c);
    }
  }

  cameraState(): CameraState {
    const { k, x, y } = this.transform;
    return { k, cx: (this.width / 2 - x) / (k * this.width), cy: (this.height / 2 - y) / (k * this.height) };
  }

  /** Current t-SNE embedding (normalised) — used when snapshotting mid-run. */
  currentTsneCoords(): (number | null)[] | null {
    if (this.view?.layout.mode !== 'tsne') return null;
    if (this.storedCoords) return this.view.layout.coords ?? null;
    return this.tsneCoords ? normaliseCoords(this.tsneCoords) : null;
  }

  pauseTsne() {
    if (this.tsneStatus.state !== 'running') return;
    this.post({ type: 'pause' });
    this.setTsneStatus({ ...this.tsneStatus, state: 'paused' });
  }

  resumeTsne() {
    if (this.tsneStatus.state !== 'paused') return;
    this.post({ type: 'resume' });
    this.setTsneStatus({ ...this.tsneStatus, state: 'running' });
  }

  /** Forces a fresh t-SNE run the next time the view (without coords) is applied. */
  invalidateTsne() {
    this.tsneNonce++;
  }

  getTsneStatus() {
    return this.tsneStatus;
  }

  /** Screen position of an annotation's note (for positioning the editor). */
  annotationScreenPosition(id: string): { x: number; y: number } | null {
    const p = this.placeAnnotations().find((a) => a.annotation.id === id);
    return p ? { x: p.x + p.annotation.dx, y: p.y + p.annotation.dy } : null;
  }

  async captureThumbnail(title = '', width = 480): Promise<string | null> {
    if (!this.table || !this.theme) return null;
    const scale = width / this.width;
    const height = Math.round(this.height * scale);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    this.render();
    ctx.drawImage(this.canvas, 0, 0, width, height);
    try {
      const clone = this.svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.querySelectorAll('.hit').forEach((n) => n.remove());
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();
      ctx.drawImage(img, 0, 0, width, height);
    } catch {
      // Overlay is decorative in thumbnails; ignore serialisation failures.
    }
    if (title) {
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = `600 ${Math.round(22 * scale * 1.4)}px Inter, system-ui, sans-serif`;
      ctx.fillText(title, 40 * scale, 58 * scale, width - 60 * scale);
    }
    return out.toDataURL('image/jpeg', 0.82);
  }

  /** Fast-forwards the simulation and all tweens (used by tests and screenshots). */
  settle(ticks = 300) {
    for (let i = 0; i < ticks; i++) this.sim.tick();
    this.displayR.set(this.targetR);
    this.displayRGBA.set(this.targetRGBA);
    this.cameraTween = null;
    this.render();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerleave', this.handlePointerLeave);
    this.container.removeEventListener('click', this.handleClick, true);
    select(this.container).on('.zoom', null);
    this.worker?.terminate();
    this.renderer.dispose();
    this.canvas.remove();
    this.svg.remove();
  }

  // ---------------------------------------------------------------------------
  // Layout

  private recompute(reheat: boolean) {
    const table = this.table;
    const view = this.view;
    if (!table || !view || !this.theme) return;
    const n = table.rowCount;
    const viewport = { width: this.width, height: this.height };
    const filterMask = computeVisibility(table, view.filters);

    const { factors, legend: sizeLegend } = computeSizes(table, view.encoding.size);
    let count = 0;
    let meanArea = 0;
    for (let i = 0; i < n; i++) {
      if (!filterMask[i]) continue;
      count++;
      meanArea += factors[i] * factors[i];
    }
    meanArea = count ? meanArea / count : 1;
    const legend = !!(view.encoding.color || view.encoding.size);
    const rect = plotRect(viewport, {}, legend);
    const base = baseRadius(count, rect.width, rect.height, meanArea);
    const radii = factors.map((f) => f * base);

    const coords = view.layout.mode === 'tsne' ? this.resolveTsne(view.layout, filterMask) : this.leaveTsne();
    const layout = computeLayout(
      view.layout,
      { table, visible: filterMask, viewport, radii, legend },
      coords,
    );
    this.layout = layout;

    let visibleCount = 0;
    this.maxR = 1;
    const collideR = new Float32Array(n);
    const pad = layout.collide < 1 ? 0 : 0.8;
    for (let i = 0; i < n; i++) {
      const vis = filterMask[i] && layout.valid[i] ? 1 : 0;
      this.visible[i] = vis;
      visibleCount += vis;
      const r = vis ? radii[i] * layout.radiusScale : 0;
      this.targetR[i] = r;
      collideR[i] = vis ? r + pad : 0;
      if (r > this.maxR) this.maxR = r;
    }

    // Hidden rows with no target keep their spot; new rows appear where they belong.
    this.sim.setTargets(layout.tx, layout.ty, layout.strengthX, layout.strengthY);
    this.sim.setCollision(collideR, layout.collide);
    if (reheat) this.sim.reheat(view.layout.mode === 'tsne' ? 0.5 : 0.9);

    const colors = computeColors(table, view.encoding, this.theme.name);
    const alpha = layout.collide < 0.5 ? 0.85 : 1;
    for (let i = 0; i < n; i++) {
      this.targetRGBA[i * 4] = colors.rgb[i * 3];
      this.targetRGBA[i * 4 + 1] = colors.rgb[i * 3 + 1];
      this.targetRGBA[i * 4 + 2] = colors.rgb[i * 3 + 2];
      this.targetRGBA[i * 4 + 3] = this.visible[i] ? alpha : 0;
    }
    this.animating = true;

    this.overlay.setAxes([layout.xAxis, layout.yAxis].filter((a) => !!a));
    this.callbacks.onLayoutInfo?.({
      message: layout.message,
      visibleCount,
      totalCount: n,
      colorLegend: colors.legend,
      sizeLegend,
      baseRadiusPx: base * layout.radiusScale,
    });
  }

  // ---------------------------------------------------------------------------
  // t-SNE

  private resolveTsne(
    spec: Extract<LayoutSpec, { mode: 'tsne' }>,
    filterMask: Uint8Array,
  ): Float32Array | null {
    const table = this.table!;
    if (spec.coords) {
      if (spec.coords !== this.storedCoordsRef) {
        this.storedCoordsRef = spec.coords;
        this.storedCoords = Float32Array.from(spec.coords, (v) => (v === null ? NaN : v));
      }
      if (this.tsneStatus.state === 'running' || this.tsneStatus.state === 'paused') this.stopTsne();
      if (this.tsneStatus.state !== 'done')
        this.setTsneStatus({
          state: 'done',
          iteration: spec.params.iterations,
          total: spec.params.iterations,
        });
      return this.storedCoords;
    }
    this.storedCoords = null;
    this.storedCoordsRef = undefined;
    const key = JSON.stringify([
      table.datasetId,
      spec.fields,
      spec.params,
      maskHash(filterMask),
      this.tsneNonce,
    ]);
    if (key === this.tsneKey) return this.tsneCoords;
    this.tsneKey = key;
    this.startTsne(spec, filterMask);
    return this.tsneCoords;
  }

  private startTsne(spec: Extract<LayoutSpec, { mode: 'tsne' }>, filterMask: Uint8Array) {
    const table = this.table!;
    const fields = spec.fields.filter((f) => table.fieldByName[f] && table.fieldByName[f].type !== 'text');
    const rows: number[] = [];
    for (let i = 0; i < table.rowCount; i++) if (filterMask[i]) rows.push(i);
    this.tsneCoords = null;
    this.tsneRows = rows;
    if (fields.length < 2 || rows.length < 5) {
      this.stopTsne();
      this.setTsneStatus({
        state: 'error',
        iteration: 0,
        total: 0,
        message: fields.length < 2 ? 'Choose at least two fields.' : 'Too few visible rows.',
      });
      return;
    }
    const { data, d } = buildTsneInput(
      fields.map((f) => table.columns[f]),
      rows,
    );
    this.worker ??= this.createWorker();
    const runId = ++this.tsneRunId;
    const perplexity = Math.max(2, Math.min(spec.params.perplexity, (rows.length - 1) / 3));
    this.post(
      {
        type: 'start',
        runId,
        data,
        n: rows.length,
        d,
        perplexity,
        epsilon: spec.params.epsilon,
        iterations: spec.params.iterations,
      },
      [data.buffer],
    );
    this.setTsneStatus({ state: 'preparing', iteration: 0, total: spec.params.iterations });
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('./tsne.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TsneResponse>) => {
      const msg = e.data;
      if (msg.runId !== this.tsneRunId || !this.table) return;
      if (msg.type === 'error') {
        this.setTsneStatus({ state: 'error', iteration: 0, total: 0, message: msg.message });
        return;
      }
      const n = this.table.rowCount;
      const coords = new Float32Array(n * 2).fill(NaN);
      this.tsneRows.forEach((row, i) => {
        coords[row * 2] = msg.coords[i * 2];
        coords[row * 2 + 1] = msg.coords[i * 2 + 1];
      });
      this.tsneCoords = coords;
      const paused = this.tsneStatus.state === 'paused';
      this.setTsneStatus({
        state: msg.done ? 'done' : paused ? 'paused' : 'running',
        iteration: msg.iteration,
        total: msg.total,
      });
      this.recompute(true);
      if (msg.done) this.callbacks.onTsneDone?.(normaliseCoords(coords));
    };
    return worker;
  }

  private post(msg: TsneRequest, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  private stopTsne() {
    if (this.worker) this.post({ type: 'stop' });
    this.tsneRunId++;
    this.tsneKey = '';
    this.tsneCoords = null;
    this.setTsneStatus({ state: 'idle', iteration: 0, total: 0 });
  }

  /** Called when the layout is not t-SNE: stops any run and forgets stored coords. */
  private leaveTsne(): null {
    if (this.tsneStatus.state !== 'idle' || this.tsneKey) this.stopTsne();
    this.storedCoordsRef = undefined;
    this.storedCoords = null;
    return null;
  }

  private setTsneStatus(status: TsneStatus) {
    this.tsneStatus = status;
    this.callbacks.onTsneStatus?.(status);
  }

  // ---------------------------------------------------------------------------
  // Camera

  private applyCamera(c: CameraState) {
    const t = zoomIdentity
      .translate(this.width / 2 - c.cx * this.width * c.k, this.height / 2 - c.cy * this.height * c.k)
      .scale(c.k);
    this.suppressCameraEvents = true;
    select(this.container).call(this.zoomBehavior.transform, t);
    this.suppressCameraEvents = false;
  }

  private stepCamera(now: number) {
    const tw = this.cameraTween;
    if (!tw) return;
    const p = Math.min(1, (now - tw.start) / CAMERA_TWEEN_MS);
    const e = easeInOut(p);
    // Interpolate zoom geometrically so scale changes feel even.
    const k = tw.from.k * (tw.to.k / tw.from.k) ** e;
    this.applyCamera({
      cx: tw.from.cx + (tw.to.cx - tw.from.cx) * e,
      cy: tw.from.cy + (tw.to.cy - tw.from.cy) * e,
      k,
    });
    if (p >= 1) this.cameraTween = null;
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height) return;
    const camera = this.cameraState();
    const dx = (w - this.width) / 2;
    const dy = (h - this.height) / 2;
    const first = this.width === 1;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    if (!first) this.sim.translate(dx, dy);
    this.applyCamera(first ? { cx: 0.5, cy: 0.5, k: 1 } : camera);
    this.recompute(true);
  }

  // ---------------------------------------------------------------------------
  // Picking

  private toWorld(clientX: number, clientY: number) {
    const rect = this.container.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - this.transform.x) / this.transform.k, y: (sy - this.transform.y) / this.transform.k };
  }

  private pick(clientX: number, clientY: number): number {
    if (!this.table) return -1;
    if (this.treeFrame !== this.frameCount) {
      const idx: number[] = [];
      for (let i = 0; i < this.visible.length; i++) if (this.visible[i]) idx.push(i);
      const nodes = this.sim.nodes;
      this.tree = quadtree<number>()
        .x((i) => nodes[i].x)
        .y((i) => nodes[i].y)
        .addAll(idx);
      this.treeFrame = this.frameCount;
    }
    const w = this.toWorld(clientX, clientY);
    const slop = 3 / this.transform.k;
    const found = this.tree?.find(w.x, w.y, this.maxR + slop);
    if (found === undefined) return -1;
    const node = this.sim.nodes[found];
    return Math.hypot(node.x - w.x, node.y - w.y) <= this.displayR[found] + slop ? found : -1;
  }

  private dragHit(e: Event): boolean {
    const p = 'touches' in e ? (e as TouchEvent).touches[0] : (e as MouseEvent);
    return !!p && this.pick(p.clientX, p.clientY) >= 0;
  }

  /** Drag a bubble: it is pinned under the pointer while the live simulation flows around it. */
  private handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.tool !== 'select') return;
    if ((e.target as Element).closest('.annotation-note, .group')) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit < 0) return;
    const node = this.sim.nodes[hit];
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    this.container.setPointerCapture(e.pointerId);
    this.container.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      const w = this.toWorld(ev.clientX, ev.clientY);
      node.fx = w.x;
      node.fy = w.y;
      this.sim.reheat(0.3);
      this.callbacks.onHover?.(null);
    };
    const up = () => {
      this.container.removeEventListener('pointermove', move);
      this.container.removeEventListener('pointerup', up);
      this.container.removeEventListener('pointercancel', up);
      this.container.classList.remove('dragging');
      node.fx = null;
      node.fy = null;
      this.sim.reheat(0.3);
      if (moved) this.suppressClick = true;
    };
    this.container.addEventListener('pointermove', move);
    this.container.addEventListener('pointerup', up);
    this.container.addEventListener('pointercancel', up);
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (e.buttons) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit !== this.hovered) this.hovered = hit;
    this.container.classList.toggle('over-bubble', hit >= 0);
    this.callbacks.onHover?.(hit >= 0 ? { row: hit, clientX: e.clientX, clientY: e.clientY } : null);
  };

  private handlePointerLeave = () => {
    this.hovered = -1;
    this.callbacks.onHover?.(null);
  };

  private handleClick = (e: MouseEvent) => {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.stopPropagation();
      return;
    }
    if ((e.target as Element).closest('.annotation-note, .group')) return;
    const hit = this.pick(e.clientX, e.clientY);
    const w = this.toWorld(e.clientX, e.clientY);
    this.callbacks.onClick?.({
      row: hit >= 0 ? hit : null,
      nx: w.x / this.width,
      ny: w.y / this.height,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  // ---------------------------------------------------------------------------
  // Frame loop

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    this.frameCount++;
    this.stepCamera(now);
    this.sim.tick();
    this.tween();
    this.render();
    this.frameTime = this.frameTime * 0.9 + (performance.now() - t0) * 0.1;
  };

  private tween() {
    if (!this.animating) return;
    let moving = false;
    const n = this.targetR.length;
    for (let i = 0; i < n; i++) {
      const dr = this.targetR[i] - this.displayR[i];
      if (Math.abs(dr) > 0.01) {
        this.displayR[i] += dr * 0.14;
        moving = true;
      } else this.displayR[i] = this.targetR[i];
    }
    for (let i = 0; i < n * 4; i++) {
      const dc = this.targetRGBA[i] - this.displayRGBA[i];
      if (Math.abs(dc) > 0.002) {
        this.displayRGBA[i] += dc * 0.12;
        moving = true;
      } else this.displayRGBA[i] = this.targetRGBA[i];
    }
    this.animating = moving;
  }

  private render() {
    const n = this.table?.rowCount ?? 0;
    const r = this.renderer;
    r.ensureCapacity(n);
    const offset = r.offset.array as Float32Array;
    const radius = r.radius.array as Float32Array;
    const color = r.color.array as Float32Array;
    const hi = r.highlight.array as Float32Array;
    const nodes = this.sim.nodes;
    for (let i = 0; i < n; i++) {
      offset[i * 2] = nodes[i].x;
      offset[i * 2 + 1] = nodes[i].y;
      hi[i] = i === this.hovered ? 1 : 0;
    }
    radius.set(this.displayR.subarray(0, n));
    color.set(this.displayRGBA.subarray(0, n * 4));
    r.render(this.transform);
    this.overlay.update(
      this.transform,
      this.width,
      this.height,
      this.groupLabels(),
      this.layout?.groups?.field ?? null,
      this.placeAnnotations(),
    );
  }

  private groupLabels(): GroupLabel[] {
    const groups = this.layout?.groups;
    if (!groups || !this.table) return [];
    const k = groups.keys.length;
    const sumX = new Float64Array(k);
    const maxY = new Float64Array(k).fill(-Infinity);
    const count = new Int32Array(k);
    const nodes = this.sim.nodes;
    for (let i = 0; i < this.visible.length; i++) {
      const g = groups.nodeGroup[i];
      if (g < 0 || !this.visible[i]) continue;
      sumX[g] += nodes[i].x;
      maxY[g] = Math.max(maxY[g], nodes[i].y + this.displayR[i]);
      count[g]++;
    }
    const out: GroupLabel[] = [];
    for (let g = 0; g < k; g++)
      if (count[g]) out.push({ key: groups.keys[g], count: count[g], x: sumX[g] / count[g], y: maxY[g] });
    return out;
  }

  private placeAnnotations(): AnnotationPlacement[] {
    const view = this.view;
    const table = this.table;
    if (!view || !table) return [];
    const t = this.transform;
    const nodes = this.sim.nodes;
    return view.annotations.map((a) => {
      const anchor = a.anchor;
      if (anchor.kind === 'point') {
        const node = nodes[anchor.row];
        const ok = !!node && !!this.visible[anchor.row];
        return {
          annotation: a,
          x: node ? node.x * t.k + t.x : 0,
          y: node ? node.y * t.k + t.y : 0,
          r: ok ? this.displayR[anchor.row] * t.k + 4 : 0,
          visible: ok,
        };
      }
      if (anchor.kind === 'group') {
        const col = table.columns[anchor.field];
        let sx = 0,
          sy = 0,
          c = 0;
        if (col?.kind === 'string') {
          for (let i = 0; i < nodes.length; i++) {
            if (!this.visible[i] || (col.values[i] ?? '') !== anchor.value) continue;
            sx += nodes[i].x;
            sy += nodes[i].y;
            c++;
          }
        }
        if (!c) return { annotation: a, x: 0, y: 0, r: 0, visible: false };
        const cx = sx / c;
        const cy = sy / c;
        let rad = 0;
        if (col?.kind === 'string') {
          for (let i = 0; i < nodes.length; i++) {
            if (!this.visible[i] || (col.values[i] ?? '') !== anchor.value) continue;
            rad = Math.max(rad, Math.hypot(nodes[i].x - cx, nodes[i].y - cy) + this.displayR[i]);
          }
        }
        return { annotation: a, x: cx * t.k + t.x, y: cy * t.k + t.y, r: rad * t.k + 6, visible: true };
      }
      const wx = anchor.x * this.width;
      const wy = anchor.y * this.height;
      return { annotation: a, x: wx * t.k + t.x, y: wy * t.k + t.y, r: 3, visible: true };
    });
  }
}

/** Views that differ only in annotations / camera / text don't need a reheat. */
function sameLayoutInputs(a: ViewState, b: ViewState): boolean {
  return a.layout === b.layout && a.encoding === b.encoding && a.filters === b.filters;
}

function maskHash(mask: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < mask.length; i++) h = Math.imul(h ^ mask[i], 16777619);
  return `${mask.length}:${h >>> 0}`;
}

/** Normalises an embedding into the unit square (aspect preserved), 4 decimals. */
function normaliseCoords(coords: Float32Array): (number | null)[] {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    if (!Number.isFinite(coords[i])) continue;
    x0 = Math.min(x0, coords[i]);
    x1 = Math.max(x1, coords[i]);
    y0 = Math.min(y0, coords[i + 1]);
    y1 = Math.max(y1, coords[i + 1]);
  }
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  return Array.from(coords, (v, i) =>
    Number.isFinite(v) ? Math.round(((v - (i % 2 === 0 ? x0 : y0)) / s) * 10000) / 10000 : null,
  );
}
