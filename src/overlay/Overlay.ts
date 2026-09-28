import { select, type Selection } from 'd3-selection';
import type { Annotation } from '../state/types';
import type { AxisGuide, RefGuide } from '../engine/layouts';
import type { Transform } from '../engine/Renderer';
import type { ThemeColors } from '../engine/palette';

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const NOTE_WIDTH = 200;
const TICK_SIZE = 13;
const AXIS_TITLE_SIZE = 14.5;
/** Matches the CSS fade on .annotation; leaving notes are removed after it. */
const NOTE_FADE_MS = 200;
/** Default note body size (px); titles are 1px larger. */
export const DEFAULT_NOTE_SIZE = 14;

export interface GroupLabel {
  key: string;
  count: number;
  /** World-space anchor: centroid x and the bottom edge of the cluster. */
  x: number;
  y: number;
}

export interface AnnotationPlacement {
  annotation: Annotation;
  /** Screen-space anchor and subject radius; null when the anchor is not visible. */
  x: number;
  y: number;
  r: number;
  visible: boolean;
  /** Stage size relative to the note's own frame: offsets and fonts are multiplied by it. */
  scale: number;
}

type NoteElement = SVGGElement & {
  __drag?: { dx: number; dy: number };
  __version?: string;
  __size?: { w: number; h: number };
};

export interface OverlayCallbacks {
  onAnnotationMove(id: string, dx: number, dy: number, done: boolean): void;
  onAnnotationEdit(id: string): void;
  onGroupClick(key: string): void;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export function wrapText(text: string, font: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, font) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines.filter((l, i) => l || i < lines.length - 1);
}

/**
 * Imperative SVG layer above the WebGL canvas. Guides are rebuilt when the
 * layout changes (old ones cross-fade out); positions are refreshed every
 * frame from the live simulation so labels and annotations follow the data.
 */
export class Overlay {
  private root: Selection<SVGSVGElement, unknown, null, undefined>;
  private guideLayer: Selection<SVGGElement, unknown, null, undefined>;
  private groupLayer: Selection<SVGGElement, unknown, null, undefined>;
  private annotationLayer: Selection<SVGGElement, unknown, null, undefined>;
  private lassoPath: Selection<SVGPathElement, unknown, null, undefined>;
  private current: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private axes: AxisGuide[] = [];
  private refs: RefGuide[] = [];
  private theme!: ThemeColors;
  private lastTransform = '';
  private groupField: string | null = null;
  interactive = false;
  /** Screen rects new notes are placed clear of (e.g. the legend). */
  avoid: { x: number; y: number; w: number; h: number }[] = [];
  /** CSS scale the stage is shown at (presenting a slide scaled to fit). */
  displayScale = 1;

  constructor(
    readonly svg: SVGSVGElement,
    private callbacks: OverlayCallbacks,
  ) {
    this.root = select(svg).attr('font-family', FONT);
    this.guideLayer = this.root.append('g').attr('class', 'guides');
    this.groupLayer = this.root.append('g').attr('class', 'group-labels');
    this.annotationLayer = this.root.append('g').attr('class', 'annotations');
    this.lassoPath = this.root
      .append('path')
      .attr('class', 'lasso')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5 4')
      .attr('stroke-linejoin', 'round')
      .attr('fill-opacity', 0.08)
      .attr('display', 'none');
  }

  /** Draws (or hides) the in-progress lasso, in screen coordinates. */
  setLasso(points: [number, number][] | null) {
    if (!points || points.length < 2) {
      this.lassoPath.attr('display', 'none');
      return;
    }
    this.lassoPath.attr('display', null).attr('d', `M${points.map((p) => p.join(',')).join('L')}Z`);
  }

  setTheme(theme: ThemeColors) {
    this.theme = theme;
    this.lassoPath.attr('stroke', theme.accent).attr('fill', theme.accent);
    this.setAxes(this.axes, this.refs, true);
    this.groupLayer.selectAll('*').remove();
    this.annotationLayer.selectAll('*').remove();
  }

  setAxes(axes: AxisGuide[], refs: RefGuide[] = [], force = false) {
    const same =
      !force &&
      JSON.stringify(axes) === JSON.stringify(this.axes) &&
      JSON.stringify(refs) === JSON.stringify(this.refs);
    if (same) return;
    this.axes = axes;
    this.refs = refs;
    if (this.current) {
      const old = this.current;
      old.attr('class', 'guide-set leaving').style('opacity', '0');
      setTimeout(() => old.remove(), 450);
    }
    const g = this.guideLayer.append('g').attr('class', 'guide-set entering');
    this.current = g;
    for (const axis of axes) this.buildAxis(g, axis);
    this.buildRefs(g, refs);
    requestAnimationFrame(() => g.attr('class', 'guide-set'));
    this.lastTransform = '';
  }

  private buildAxis(g: Selection<SVGGElement, unknown, null, undefined>, axis: AxisGuide) {
    const t = this.theme;
    const a = g.append('g').attr('data-orient', axis.orient);
    const ticks = a.selectAll('g.tick').data(axis.ticks).join('g').attr('class', 'tick');
    if (axis.grid) ticks.append('line').attr('class', 'grid').attr('stroke', t.grid).attr('stroke-width', 1);
    ticks
      .append('text')
      .attr('class', 'tick-label')
      .attr('fill', t.textSecondary)
      .attr('font-size', TICK_SIZE)
      .attr('text-anchor', axis.orient === 'bottom' ? 'middle' : 'end')
      .attr('dominant-baseline', axis.orient === 'bottom' ? 'hanging' : 'middle')
      .text((d) => d.label);
    a.append('line').attr('class', 'domain').attr('stroke', t.axis).attr('stroke-width', 1);
    const labelFont = `${TICK_SIZE}px ${FONT}`;
    a.attr('data-label-width', Math.max(0, ...axis.ticks.map((d) => measure(d.label, labelFont))));
    a.append('text')
      .attr('class', 'axis-title')
      .attr('fill', t.textPrimary)
      .attr('font-size', AXIS_TITLE_SIZE)
      .attr('font-weight', 600)
      .attr('text-anchor', 'middle')
      .text(axis.title);
  }

  /** Mean / median lines: a soft halo under a line so they read over dense bubbles. */
  private buildRefs(g: Selection<SVGGElement, unknown, null, undefined>, refs: RefGuide[]) {
    if (!refs.length) return;
    const t = this.theme;
    const layer = g.append('g').attr('class', 'refs');
    const r = layer
      .selectAll('g.ref')
      .data(refs)
      .join('g')
      .attr('class', (d) => (d.lane ? 'ref lane' : 'ref'));
    r.append('line')
      .attr('class', 'ref-halo')
      .attr('stroke', t.surface)
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', (d) => (d.lane ? 5 : 4))
      .attr('stroke-linecap', 'round');
    r.append('line')
      .attr('class', 'ref-line')
      .attr('stroke', t.textPrimary)
      .attr('stroke-opacity', 0.9)
      .attr('stroke-width', (d) => (d.lane ? 2.25 : 1.5))
      .attr('stroke-dasharray', (d) => (d.lane ? null : '6 4'))
      .attr('stroke-linecap', 'round');
    r.append('text')
      .attr('class', 'ref-label')
      .attr('fill', t.textPrimary)
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('stroke', t.surface)
      .attr('stroke-width', 3.5)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text((d) => d.label);
  }

  private positionRefs(sx: (v: number) => number, sy: (v: number) => number) {
    if (!this.current) return;
    const refs = this.current.selectAll<SVGGElement, RefGuide>('g.ref');
    refs.each(function (d) {
      const g = select(this);
      let x1: number, x2: number, y1: number, y2: number;
      const label = g.select('text.ref-label');
      if (d.axis === 'x') {
        // Vertical line at an x value.
        x1 = x2 = sx(d.pos);
        y1 = sy(d.from);
        y2 = sy(d.to);
        label
          .attr('x', x1 + 6)
          .attr('y', Math.min(y1, y2) + (d.lane ? 11 : 13))
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'middle');
      } else {
        // Horizontal line at a y value.
        y1 = y2 = sy(d.pos);
        x1 = sx(d.from);
        x2 = sx(d.to);
        label
          .attr('x', Math.max(x1, x2) - (d.lane ? 0 : 4))
          .attr('y', y1 - 7)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'auto');
      }
      g.selectAll('line').attr('x1', x1).attr('x2', x2).attr('y1', y1).attr('y2', y2);
    });
  }

  private positionAxes(t: Transform, width: number, height: number) {
    if (!this.current) return;
    const key = `${t.k},${t.x},${t.y},${width},${height}`;
    if (key === this.lastTransform) return;
    this.lastTransform = key;
    const sx = (v: number) => v * t.k + t.x;
    const sy = (v: number) => v * t.k + t.y;
    this.positionRefs(sx, sy);
    const groups = this.current.selectAll<SVGGElement, unknown>('g[data-orient]').nodes();
    for (const [i, axis] of this.axes.entries()) {
      const a = select(groups[i]);
      if (!groups[i]) continue;
      if (axis.orient === 'bottom') {
        const y = Math.min(sy(axis.cross), height - 100);
        const [s0, s1] = [Math.max(0, sy(axis.span[0])), Math.min(height, sy(axis.span[1]))];
        a.selectAll<SVGGElement, { pos: number }>('g.tick').attr(
          'transform',
          (d) => `translate(${sx(d.pos)},0)`,
        );
        a.selectAll('line.grid')
          .attr('y1', s0)
          .attr('y2', Math.max(s0, Math.min(s1, y)));
        a.selectAll('text.tick-label').attr('y', y + 8);
        const r0 = sx(axis.ticks[0]?.pos ?? 0);
        const r1 = sx(axis.ticks.at(-1)?.pos ?? 0);
        a.select('line.domain')
          .attr('x1', r0)
          .attr('x2', r1)
          .attr('y1', y)
          .attr('y2', y)
          .attr('opacity', axis.grid ? 1 : 0);
        a.select('text.axis-title')
          .attr('x', (r0 + r1) / 2)
          .attr('y', y + 40);
      } else {
        const x = Math.max(sx(axis.cross), 40 + (Number(a.attr('data-label-width')) || 30));
        const [s0, s1] = [Math.max(0, sx(axis.span[0])), Math.min(width, sx(axis.span[1]))];
        a.selectAll<SVGGElement, { pos: number }>('g.tick').attr(
          'transform',
          (d) => `translate(0,${sy(d.pos)})`,
        );
        a.selectAll('line.grid')
          .attr('x1', Math.min(s1, Math.max(s0, x)))
          .attr('x2', s1);
        a.selectAll('text.tick-label').attr('x', x - 8);
        const r0 = sy(axis.ticks[0]?.pos ?? 0);
        const r1 = sy(axis.ticks.at(-1)?.pos ?? 0);
        a.select('line.domain')
          .attr('x1', x)
          .attr('x2', x)
          .attr('y1', r0)
          .attr('y2', r1)
          .attr('opacity', axis.grid ? 1 : 0);
        const cy = (r0 + r1) / 2;
        const labelW = Number(a.attr('data-label-width')) || 30;
        a.select('text.axis-title').attr(
          'transform',
          `translate(${Math.max(14, x - labelW - 26)},${cy}) rotate(-90)`,
        );
      }
    }
  }

  private updateGroups(groups: GroupLabel[], field: string | null, t: Transform) {
    if (field !== this.groupField) {
      this.groupField = field;
      this.groupLayer.selectAll('g.group').remove();
    }
    const th = this.theme;
    const sel = this.groupLayer
      .selectAll<SVGGElement, GroupLabel>('g.group')
      .data(groups, (d) => d.key)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'group entering');
        g.append('rect').attr('class', 'hit').attr('fill', 'transparent');
        g.append('text')
          .attr('class', 'group-name')
          .attr('text-anchor', 'middle')
          .attr('font-size', 14)
          .attr('font-weight', 600)
          .attr('fill', th.textPrimary);
        g.append('text')
          .attr('class', 'group-count')
          .attr('text-anchor', 'middle')
          .attr('font-size', 12)
          .attr('y', 17)
          .attr('fill', th.textMuted);
        g.on('click', (_e, d) => this.callbacks.onGroupClick(d.key));
        requestAnimationFrame(() => g.attr('class', 'group'));
        return g;
      });
    sel.attr('transform', (d) => `translate(${d.x * t.k + t.x},${d.y * t.k + t.y + 18})`);
    sel.select('text.group-name').text((d) => d.key);
    sel.select('text.group-count').text((d) => d.count.toLocaleString());
    sel
      .select('rect.hit')
      .attr('x', -60)
      .attr('y', -14)
      .attr('width', 120)
      .attr('height', 34)
      .style('pointer-events', this.interactive ? 'all' : 'none')
      .style('cursor', this.interactive ? 'copy' : 'default');
  }

  private updateAnnotations(placements: AnnotationPlacement[]) {
    const th = this.theme;
    const sel = this.annotationLayer
      .selectAll<SVGGElement, AnnotationPlacement>('g.annotation:not(.leaving)')
      .data(placements, (d) => d.annotation.id)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'annotation entering');
          g.append('circle')
            .attr('class', 'subject')
            .attr('fill', 'none')
            .attr('stroke', th.textPrimary)
            .attr('stroke-width', 1.25);
          g.append('line').attr('class', 'connector').attr('stroke', th.textPrimary).attr('stroke-width', 1);
          const note = g.append('g').attr('class', 'annotation-note');
          note.append('rect').attr('class', 'hit').attr('fill', 'transparent');
          note.append('line').attr('class', 'rule').attr('stroke', th.textPrimary).attr('stroke-width', 1.25);
          note.append('text').attr('class', 'note-text');
          note.on('pointerdown', (e: PointerEvent, d) => this.startDrag(e, d));
          note.on('dblclick', (e: MouseEvent, d) => {
            e.stopPropagation();
            this.callbacks.onAnnotationEdit(d.annotation.id);
          });
          requestAnimationFrame(() => g.classed('entering', false));
          return g;
        },
        (update) => update,
        (exit) => {
          // Fade out, then remove. Leaving notes are never reused: one that comes
          // back gets a fresh element (and rebuilds its text).
          exit.classed('leaving', true).style('opacity', '0').style('pointer-events', 'none');
          exit.each(function () {
            setTimeout(() => this.remove(), NOTE_FADE_MS);
          });
          return exit;
        },
      );

    sel.each(function (d) {
      const g = select(this);
      const a = d.annotation;
      // Render caches live on the element itself: a note that leaves and re-enters
      // (slide changes, edit ↔ present) gets a fresh element and must rebuild its text.
      const node = g.node() as NoteElement;
      const drag = node.__drag;
      // Notes sit exactly at their stored offset (WYSIWYG across editor, previews
      // and presentation). Keeping clear of edges happens once, when a note is placed.
      // Offsets and fonts are in the note's frame units and scale with the stage.
      const s = d.scale || 1;
      const dx = (drag?.dx ?? a.dx) * s;
      const dy = (drag?.dy ?? a.dy) * s;
      const isText = a.style === 'text';
      // Inline opacity (not a class) so exports, which carry no stylesheet, respect it;
      // the CSS transition on .annotation turns changes into quick fades.
      g.attr('data-visible', d.visible ? 1 : 0).style(
        'opacity',
        d.visible && !g.classed('entering') ? '1' : '0',
      );

      // Rebuild the text only when content, size, style or side changes.
      const round = (v: number) => Math.round(v * 100) / 100;
      const bodySize = round((a.fontSize ?? DEFAULT_NOTE_SIZE) * s);
      const titleSize = round(((a.fontSize ?? DEFAULT_NOTE_SIZE) + 1) * s);
      const side = isText ? 'text' : `${dx >= 0 ? 'r' : 'l'}${dy >= 0 ? 'b' : 't'}`;
      const version = `${a.title}\u0000${a.text}\u0000${side}\u0000${bodySize}`;
      const text = g.select<SVGTextElement>('text.note-text');
      if (node.__version !== version) {
        node.__version = version;
        text.selectAll('*').remove();
        const titleFont = `600 ${titleSize}px ${FONT}`;
        const bodyFont = `${bodySize}px ${FONT}`;
        // Wrap width grows with the font so big text doesn't become a narrow column.
        const maxW = Math.min(520 * s, (NOTE_WIDTH * bodySize) / 13);
        const lines: { t: string; title: boolean }[] = [
          ...(a.title ? wrapText(a.title, titleFont, maxW).map((t) => ({ t, title: true })) : []),
          ...(a.text ? wrapText(a.text, bodyFont, maxW).map((t) => ({ t, title: false })) : []),
        ];
        const anchor = isText || dx >= 0 ? 'start' : 'end';
        const lineH = round(bodySize * 1.35);
        const total = lines.length * lineH;
        // Text boxes hang below their origin; callouts sit below/above the rule.
        const y0 = isText ? titleSize : dy >= 0 ? lineH + 2 * s : -6 * s - total + lineH - 4 * s;
        lines.forEach((l, i) => {
          text
            .append('tspan')
            .attr('x', 0)
            .attr('y', y0 + i * lineH)
            .attr('text-anchor', anchor)
            .attr('font-size', l.title ? titleSize : bodySize)
            .attr('font-weight', l.title ? 600 : 400)
            .attr('fill', l.title ? th.textPrimary : th.textSecondary)
            .text(l.t || ' ');
        });
        const textWidth = Math.max(40, ...lines.map((l) => measure(l.t, l.title ? titleFont : bodyFont)));
        const w = Math.min(maxW, textWidth);
        node.__size = { w, h: total + 14 };
        g.select('line.rule')
          .attr('x1', 0)
          .attr('x2', dx >= 0 ? w : -w)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('display', isText ? 'none' : null);
        g.select('rect.hit')
          .attr('x', isText ? -6 : dx >= 0 ? -4 : -w - 4)
          .attr('y', isText ? -4 : dy >= 0 ? -6 : -total - 8)
          .attr('width', w + (isText ? 12 : 8))
          .attr('height', total + (isText ? 10 : 14));
      }

      const nx = d.x + dx;
      const ny = d.y + dy;
      g.select('g.annotation-note').attr('transform', `translate(${nx},${ny})`);
      const dist = Math.hypot(dx, dy) || 1;
      const r = d.r;
      g.select('circle.subject')
        .attr('cx', d.x)
        .attr('cy', d.y)
        .attr('r', Math.max(0, r))
        .attr('display', isText ? 'none' : null)
        .attr('opacity', r > 0 ? 1 : 0);
      g.select('line.connector')
        .attr('x1', d.x + (dx / dist) * r)
        .attr('y1', d.y + (dy / dist) * r)
        .attr('x2', nx)
        .attr('y2', ny)
        .attr('display', isText ? 'none' : null)
        .attr('opacity', dist > r + 4 ? 1 : 0);
    });
  }

  private startDrag(e: PointerEvent, d: AnnotationPlacement) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const g = (e.currentTarget as Element).parentNode as SVGGElement & {
      __drag?: { dx: number; dy: number };
    };
    const start = { x: e.clientX, y: e.clientY, dx: d.annotation.dx, dy: d.annotation.dy };
    // Drag offsets stay in the note's frame units (screen px ÷ stage and note scale).
    const scale = (this.displayScale || 1) * (d.scale || 1);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = start.dx + (ev.clientX - start.x) / scale;
      const dy = start.dy + (ev.clientY - start.y) / scale;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 2) moved = true;
      g.__drag = { dx, dy };
      this.callbacks.onAnnotationMove(d.annotation.id, dx, dy, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const final = g.__drag;
      delete g.__drag;
      if (moved && final) this.callbacks.onAnnotationMove(d.annotation.id, final.dx, final.dy, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  update(
    t: Transform,
    width: number,
    height: number,
    groups: GroupLabel[],
    groupField: string | null,
    annotations: AnnotationPlacement[],
  ) {
    this.root.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    this.positionAxes(t, width, height);
    this.updateGroups(groups, groupField, t);
    this.updateAnnotations(annotations);
  }
}
