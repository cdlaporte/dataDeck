import { quadtree, type Quadtree } from 'd3-quadtree';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { computeVisibility } from '../data/filters';
import { Overlay, type AnnotationPlacement, type GroupLabel } from '../overlay/Overlay';
import type {
  AnnotationAnchor,
  CameraState,
  CategoryColors,
  DataTable,
  Frame,
  LayoutSpec,
  ViewState,
} from '../state/types';
import {
  GREYED_ALPHA,
  anchorRows,
  applyHighlights,
  baseRadius,
  computeColors,
  computeSizes,
  highlightSignature,
  type ColorLegend,
  type SizeLegend,
} from './encodings';
import { computeLayout, overlapAllowed, type LayoutResult } from './layouts';
import { plotRect } from './layouts/common';
import type { ThemeColors } from './palette';
import { drawLegend } from './drawLegend';
import { Renderer, type Transform } from './Renderer';
import { Simulation } from './Simulation';
import { buildTsneInput } from './tsne';
import { pointInPolygon } from './lasso';
import { MOTION, TickClock, easeInOutCubic, type MotionParams, type MotionPreset } from './motion';
import type { TsneRequest, TsneResponse } from './tsne.worker';

export type Tool = 'select' | 'annotate' | 'lasso' | 'text';

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
  /** Lasso finished: rows inside it (additive = Shift held, add to the selection). */
  onSelect?(rows: number[], additive: boolean): void;
}

/** Opacity of unselected bubbles while a selection exists. */
const DIMMED_ALPHA = 0.2;
/** Reheat strength for a view change, and for incremental t-SNE progress. */
const REHEAT_VIEW = 0.6;
const REHEAT_TSNE = 0.3;

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
  /** CSS scale the stage is displayed at (a slide presented scaled to fit). */
  private displayScale = 1;
  private transform: Transform = { k: 1, x: 0, y: 0 };
  private cameraTween: { from: CameraState; to: CameraState; start: number; ms: number } | null = null;
  private suppressCameraEvents = false;
  private suppressClick = false;
  private motion: MotionParams = MOTION.balanced;
  private clock = new TickClock();
  private lastFrame = -1;
  private lasso: { points: [number, number][]; additive: boolean } | null = null;

  private table: DataTable | null = null;
  private view: ViewState | null = null;
  private theme: ThemeColors | null = null;
  private categoryColors: CategoryColors = {};
  private tool: Tool = 'select';
  private layout: LayoutResult | null = null;
  private layoutInfo: LayoutInfo | null = null;

  // Per-row state.
  private visible = new Uint8Array(0);
  private targetR = new Float32Array(0);
  private displayR = new Float32Array(0);
  private targetRGBA = new Float32Array(0);
  private displayRGBA = new Float32Array(0);
  private hovered = -1;
  private animating = true;
  /** Base opacity per row from the last recompute, before selection dimming. */
  private baseAlpha = new Float32Array(0);
  private selected: Uint8Array | null = null;
  /** Colours from the colour encoding, before highlighting (RGB, 3 per row). */
  private encodedRGB: Float32Array = new Float32Array(0);
  /** Rows greyed out by a highlighting annotation (null when none highlights). */
  private greyed: Uint8Array | null = null;
  /** Instance draw order (back to front). */
  private drawOrder = new Int32Array(0);

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
    /** Headless engines (offscreen thumbnail rendering) run no animation loop. */
    private options: { headless?: boolean } = {},
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
        // d3's pointer maths ignores CSS scaling; a scaled slide keeps its own camera.
        if (this.displayScale !== 1) return false;
        const me = e as MouseEvent;
        if (e.type === 'mousedown' || e.type === 'touchstart') {
          // Lasso tool / Shift-drag draw a selection; pressing a bubble drags it. Neither pans.
          if (this.tool === 'lasso' || me.shiftKey) return false;
          if (this.tool === 'select' && this.dragHit(e)) return false;
        }
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
    if (!this.options.headless) this.raf = requestAnimationFrame(this.frame);
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
    this.container.classList.toggle('tool-lasso', tool === 'lasso');
    this.container.classList.toggle('tool-text', tool === 'text');
  }

  setMotion(preset: MotionPreset) {
    this.motion = MOTION[preset] ?? MOTION.balanced;
    this.sim.setMotion(this.motion);
  }

  /** Rings one bubble as if hovered (used by Find); -1 clears. */
  pulseRow(row: number) {
    this.hovered = row;
  }

  /** Highlights the given rows (others are dimmed); an empty list clears the selection. */
  setSelection(rows: readonly number[]) {
    const n = this.table?.rowCount ?? 0;
    if (!rows.length || !n) {
      this.selected = null;
    } else {
      this.selected = new Uint8Array(n);
      for (const r of rows) if (r >= 0 && r < n) this.selected[r] = 1;
    }
    this.applyAlphaTargets();
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
      this.baseAlpha = new Float32Array(n);
      this.selected = null;
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
    // Reference lines are guides only: refresh them without moving the bubbles.
    else if (prev.reference !== view.reference) this.recompute(false);
    else if (highlightSignature(prev.annotations) !== highlightSignature(view.annotations))
      this.applyColors();
    const current = this.cameraState();
    const c = view.camera;
    if (
      Math.abs(c.cx - current.cx) > 1e-4 ||
      Math.abs(c.cy - current.cy) > 1e-4 ||
      Math.abs(c.k - current.k) > 1e-4
    ) {
      if (opts.animateCamera)
        this.cameraTween = {
          from: current,
          to: { ...c },
          start: performance.now(),
          ms: this.motion.cameraMs,
        };
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

  /**
   * Renders the current view (bubbles, overlay, and optionally title, caption and
   * legend) to a canvas `scale`× the stage's CSS size.
   */
  async captureImage(
    opts: { scale?: number; title?: string; caption?: string; legend?: boolean } = {},
  ): Promise<HTMLCanvasElement | null> {
    if (!this.table || !this.theme) return null;
    const s = opts.scale ?? 1;
    const width = Math.round(this.width * s);
    const height = Math.round(this.height * s);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = this.theme.surface;
    ctx.fillRect(0, 0, width, height);
    this.render();
    ctx.drawImage(this.canvas, 0, 0, width, height);
    try {
      const clone = this.svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.querySelectorAll('.hit, .lasso, .leaving').forEach((n) => n.remove());
      // Notes still waiting to fade in are captured fully visible.
      clone
        .querySelectorAll<SVGElement>('.annotation.entering[data-visible="1"]')
        .forEach((n) => (n.style.opacity = '1'));
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();
      ctx.drawImage(img, 0, 0, width, height);
    } catch {
      // The overlay is decorative in exports; ignore serialisation failures.
    }
    const font = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';
    const maxW = (this.width - 300) * s;
    if (opts.title) {
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = `700 ${22 * s}px ${font}`;
      ctx.fillText(opts.title, 28 * s, 52 * s, maxW);
    }
    if (opts.caption) {
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = `${14 * s}px ${font}`;
      ctx.fillText(opts.caption, 28 * s, 78 * s, maxW);
    }
    if (opts.legend && this.layoutInfo)
      drawLegend(ctx, this.layoutInfo, this.table, this.theme, this.width - 20, 24, s);
    return out;
  }

  async captureThumbnail(title = '', width = 480): Promise<string | null> {
    const canvas = await this.captureImage({ scale: width / this.width, title });
    return canvas ? canvas.toDataURL('image/jpeg', 0.82) : null;
  }

  /** Puts every bubble straight onto its target (offscreen rendering), skipping the glide. */
  jumpToTargets() {
    this.sim.jumpToTargets();
    this.displayR.set(this.targetR);
    this.displayRGBA.set(this.targetRGBA);
  }

  /** Fast-forwards the simulation and all tweens (used by tests and screenshots). */
  settle(ticks = 300) {
    for (let i = 0; i < ticks; i++) this.sim.tick();
    this.clock = new TickClock();
    this.displayR.set(this.targetR);
    this.displayRGBA.set(this.targetRGBA);
    if (this.cameraTween) this.applyCamera(this.cameraTween.to);
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

  /**
   * Recomputes layout targets, sizes and colours from the current view.
   * `transitionMs` overrides how long targets glide (t-SNE progress uses a short one).
   */
  private recompute(reheat: boolean, transitionMs?: number) {
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
      { table, visible: filterMask, viewport, radii, legend, reference: view.reference },
      coords,
    );
    this.layout = layout;

    let visibleCount = 0;
    this.maxR = 1;
    const collideR = new Float32Array(n);
    // "Let bubbles overlap": no collisions, and a firm pull so bubbles sit exactly on their values.
    const overlap = !!view.overlap && overlapAllowed(view.layout, table);
    const pad = overlap || layout.collide < 1 ? 0 : 0.8;
    // Slightly soft collisions settle without jitter while still packing cleanly.
    const collide = overlap ? 0 : layout.collide >= 1 ? 0.85 : layout.collide;
    if (overlap) {
      layout.strengthX = Math.max(layout.strengthX, 0.3);
      layout.strengthY = Math.max(layout.strengthY, 0.3);
    }
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
    this.sim.setTargets(layout.tx, layout.ty, layout.strengthX, layout.strengthY, transitionMs);
    this.sim.setCollision(collideR, collide);
    this.sim.setDensity(visibleCount);
    if (reheat) this.sim.reheat(transitionMs !== undefined ? REHEAT_TSNE : REHEAT_VIEW);

    const colors = computeColors(table, view.encoding, this.theme.name, this.categoryColors);
    this.encodedRGB = colors.rgb;
    const alpha = overlap ? 0.75 : layout.collide < 0.5 ? 0.85 : 1;
    for (let i = 0; i < n; i++) this.baseAlpha[i] = this.visible[i] ? alpha : 0;
    this.applyColors();

    this.overlay.setAxes(
      [layout.xAxis, layout.yAxis].filter((a) => !!a),
      layout.refs ?? [],
    );
    this.layoutInfo = {
      message: layout.message,
      visibleCount,
      totalCount: n,
      colorLegend: colors.legend,
      sizeLegend,
      baseRadiusPx: base * layout.radiusScale,
    };
    this.callbacks.onLayoutInfo?.(this.layoutInfo);
  }

  /** Deck-wide custom category colours; recolours bubbles in place. */
  setCategoryColors(colors: CategoryColors) {
    if (colors === this.categoryColors) return;
    this.categoryColors = colors;
    const table = this.table;
    const view = this.view;
    if (!table || !view || !this.theme) return;
    const encoded = computeColors(table, view.encoding, this.theme.name, colors);
    this.encodedRGB = encoded.rgb;
    this.applyColors();
    if (this.layoutInfo) {
      this.layoutInfo = { ...this.layoutInfo, colorLegend: encoded.legend };
      this.callbacks.onLayoutInfo?.(this.layoutInfo);
    }
  }

  /** Encoded colours + annotation highlighting → target colours. */
  private applyColors() {
    const table = this.table;
    if (!table || !this.view || !this.theme) return;
    const { rgb, greyed } = applyHighlights(table, this.view.annotations, this.encodedRGB, this.theme.name);
    this.greyed = greyed;
    for (let i = 0; i < table.rowCount; i++) {
      this.targetRGBA[i * 4] = rgb[i * 3];
      this.targetRGBA[i * 4 + 1] = rgb[i * 3 + 1];
      this.targetRGBA[i * 4 + 2] = rgb[i * 3 + 2];
    }
    this.applyAlphaTargets();
  }

  private applyAlphaTargets() {
    const sel = this.selected;
    const greyed = this.greyed;
    const n = this.baseAlpha.length;
    const back: number[] = [];
    const front: number[] = [];
    for (let i = 0; i < n; i++) {
      let a = this.baseAlpha[i];
      let dimmed = false;
      if (greyed?.[i]) {
        a = Math.min(a, GREYED_ALPHA);
        dimmed = true;
      }
      if (sel && !sel[i]) {
        a = Math.min(a, DIMMED_ALPHA);
        dimmed = true;
      }
      this.targetRGBA[i * 4 + 3] = a;
      (dimmed ? back : front).push(i);
    }
    this.drawOrder = Int32Array.from(back.concat(front));
    this.animating = true;
  }

  /** Screen rects (stage coordinates) that annotation notes should avoid. */
  setAvoidRects(rects: { x: number; y: number; w: number; h: number }[]) {
    this.overlay.avoid = rects;
  }

  /** Logical stage size: what a slide's frame records. */
  size(): Frame {
    return { width: this.width, height: this.height };
  }

  /** The stage is shown CSS-scaled by `s`: keep bubbles crisp and pointer maths right. */
  setDisplayScale(s: number) {
    const scale = Number.isFinite(s) && s > 0 ? s : 1;
    if (scale === this.displayScale) return;
    this.displayScale = scale;
    this.overlay.displayScale = scale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * Math.min(Math.max(scale, 1), 2));
  }

  /**
   * Offset for a new note: as given if the note (estimated size) fits on screen
   * clear of the legend, else mirrored horizontally, vertically or both.
   * The result is stored, so the note then looks the same everywhere.
   */
  fitNoteOffset(anchor: AnnotationAnchor, dx: number, dy: number): [number, number] {
    const p = this.placeAnchor(anchor);
    if (!p.visible) return [dx, dy];
    const W = 170;
    const H = 48;
    const M = 10;
    const fits = (ox: number, oy: number) => {
      const x0 = ox >= 0 ? p.x + ox - 4 : p.x + ox - W - 4;
      const x1 = x0 + W + 8;
      const y0 = oy >= 0 ? p.y + oy - 6 : p.y + oy - H;
      const y1 = y0 + H + 8;
      if (x0 < M || y0 < M || x1 > this.width - M || y1 > this.height - M) return false;
      return !this.overlay.avoid.some((r) => x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y);
    };
    const options: [number, number][] = [
      [dx, dy],
      [-dx, dy],
      [dx, -dy],
      [-dx, -dy],
    ];
    return options.find(([ox, oy]) => fits(ox, oy)) ?? [dx, dy];
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
      // Short glides between progress updates keep the embedding flowing smoothly.
      this.recompute(true, 250);
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
    const p = Math.min(1, (now - tw.start) / tw.ms);
    const e = easeInOutCubic(p);
    // Interpolate zoom geometrically so scale changes feel even.
    const k = tw.from.k * (tw.to.k / tw.from.k) ** e;
    this.applyCamera({
      cx: tw.from.cx + (tw.to.cx - tw.from.cx) * e,
      cy: tw.from.cy + (tw.to.cy - tw.from.cy) * e,
      k,
    });
    if (p >= 1) this.cameraTween = null;
  }

  /** Picks up a container size change immediately (layout size, not the CSS-scaled size). */
  syncSize() {
    this.resize();
  }

  private resize() {
    const w = Math.max(1, Math.round(this.container.clientWidth));
    const h = Math.max(1, Math.round(this.container.clientHeight));
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
    const s = this.displayScale;
    const sx = (clientX - rect.left) / s;
    const sy = (clientY - rect.top) / s;
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
    if (e.button !== 0) return;
    if ((e.target as Element).closest('.annotation-note, .group')) return;
    if (this.tool === 'lasso' || (this.tool === 'select' && e.shiftKey)) {
      this.startLasso(e);
      return;
    }
    if (this.tool !== 'select') return;
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

  /** Freehand lasso: collect screen points, then select visible bubbles inside the polygon. */
  private startLasso(e: PointerEvent) {
    const origin = this.container.getBoundingClientRect();
    const local = (ev: PointerEvent): [number, number] => [ev.clientX - origin.left, ev.clientY - origin.top];
    this.lasso = { points: [local(e)], additive: e.shiftKey };
    this.container.setPointerCapture(e.pointerId);
    this.callbacks.onHover?.(null);
    const move = (ev: PointerEvent) => {
      const lasso = this.lasso;
      if (!lasso) return;
      const p = local(ev);
      const last = lasso.points[lasso.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 3) lasso.points.push(p);
      this.overlay.setLasso(lasso.points);
    };
    const up = () => {
      this.container.removeEventListener('pointermove', move);
      this.container.removeEventListener('pointerup', up);
      this.container.removeEventListener('pointercancel', up);
      const lasso = this.lasso;
      this.lasso = null;
      this.overlay.setLasso(null);
      if (!lasso) return;
      this.suppressClick = true;
      const pts = lasso.points;
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        area += x0 * y1 - x1 * y0;
      }
      // A click (or a scribble with no area) clears the selection.
      if (pts.length < 3 || Math.abs(area) / 2 < 16) {
        if (!lasso.additive) this.callbacks.onSelect?.([], false);
        return;
      }
      const t = this.transform;
      const nodes = this.sim.nodes;
      const rows: number[] = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!this.visible[i]) continue;
        if (pointInPolygon(nodes[i].x * t.k + t.x, nodes[i].y * t.k + t.y, pts)) rows.push(i);
      }
      this.callbacks.onSelect?.(rows, lasso.additive);
    };
    this.container.addEventListener('pointermove', move);
    this.container.addEventListener('pointerup', up);
    this.container.addEventListener('pointercancel', up);
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (e.buttons || this.lasso) return;
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
    // Fixed 60 Hz simulation steps: identical motion on 60 Hz and 120 Hz displays.
    const ticks = this.clock.advance(now);
    for (let i = 0; i < ticks; i++) this.sim.tick();
    const dt = this.lastFrame < 0 ? 16 : Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.tween(dt);
    this.render();
    this.frameTime = this.frameTime * 0.9 + (performance.now() - t0) * 0.1;
  };

  /** Time-based exponential easing of radii and colours toward their targets. */
  private tween(dt: number) {
    if (!this.animating) return;
    let moving = false;
    const k = 1 - Math.exp(-dt / this.motion.tweenMs);
    const n = this.targetR.length;
    for (let i = 0; i < n; i++) {
      const dr = this.targetR[i] - this.displayR[i];
      if (Math.abs(dr) > 0.01) {
        this.displayR[i] += dr * k;
        moving = true;
      } else this.displayR[i] = this.targetR[i];
    }
    for (let i = 0; i < n * 4; i++) {
      const dc = this.targetRGBA[i] - this.displayRGBA[i];
      if (Math.abs(dc) > 0.002) {
        this.displayRGBA[i] += dc * k;
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
    // Instances draw in `drawOrder`, so emphasised bubbles (selected /
    // highlighted) sit on top of dimmed ones.
    const order = this.drawOrder.length === n ? this.drawOrder : null;
    for (let k = 0; k < n; k++) {
      const i = order ? order[k] : k;
      offset[k * 2] = nodes[i].x;
      offset[k * 2 + 1] = nodes[i].y;
      hi[k] = i === this.hovered ? 1 : 0;
      radius[k] = this.displayR[i];
      color[k * 4] = this.displayRGBA[i * 4];
      color[k * 4 + 1] = this.displayRGBA[i * 4 + 1];
      color[k * 4 + 2] = this.displayRGBA[i * 4 + 2];
      color[k * 4 + 3] = this.displayRGBA[i * 4 + 3];
    }
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

  /** Centroid and enclosing radius (world units) of the visible bubbles among `rows`. */
  private enclosingCircle(rows: Iterable<number>): { x: number; y: number; r: number } | null {
    const nodes = this.sim.nodes;
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (const i of rows) {
      if (!this.visible[i]) continue;
      sx += nodes[i].x;
      sy += nodes[i].y;
      c++;
    }
    if (!c) return null;
    const x = sx / c;
    const y = sy / c;
    let r = 0;
    for (const i of rows) {
      if (!this.visible[i]) continue;
      r = Math.max(r, Math.hypot(nodes[i].x - x, nodes[i].y - y) + this.displayR[i]);
    }
    return { x, y, r };
  }

  private placeAnnotations(): AnnotationPlacement[] {
    if (!this.view) return [];
    return this.view.annotations.map((a) => ({ annotation: a, ...this.placeAnchor(a.anchor) }));
  }

  /** Screen position and subject radius of an annotation anchor. */
  private placeAnchor(anchor: AnnotationAnchor): Omit<AnnotationPlacement, 'annotation'> {
    const hidden = { x: 0, y: 0, r: 0, visible: false };
    const table = this.table;
    if (!table) return hidden;
    const t = this.transform;
    const nodes = this.sim.nodes;
    if (anchor.kind === 'point') {
      const node = nodes[anchor.row];
      if (!node) return hidden;
      const ok = !!this.visible[anchor.row];
      return {
        x: node.x * t.k + t.x,
        y: node.y * t.k + t.y,
        r: ok ? this.displayR[anchor.row] * t.k + 4 : 0,
        visible: ok,
      };
    }
    if (anchor.kind === 'group' || anchor.kind === 'rows') {
      const circle = this.enclosingCircle(anchorRows(table, anchor));
      if (!circle) return hidden;
      return { x: circle.x * t.k + t.x, y: circle.y * t.k + t.y, r: circle.r * t.k + 6, visible: true };
    }
    const wx = anchor.x * this.width;
    const wy = anchor.y * this.height;
    return { x: wx * t.k + t.x, y: wy * t.k + t.y, r: 3, visible: true };
  }

  /** On-screen radius of an anchor's subject circle (used to place new notes outside it). */
  subjectRadius(anchor: AnnotationAnchor): number {
    return this.placeAnchor(anchor).r;
  }
}

/** Views that differ only in annotations / camera / text don't need a reheat. */
function sameLayoutInputs(a: ViewState, b: ViewState): boolean {
  return (
    a.layout === b.layout && a.encoding === b.encoding && a.filters === b.filters && a.overlap === b.overlap
  );
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
