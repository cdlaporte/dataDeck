import { select, type Selection } from 'd3-selection';
import type { Annotation } from '../state/types';
import type { AxisGuide } from '../engine/layouts';
import type { Transform } from '../engine/Renderer';
import type { ThemeColors } from '../engine/palette';

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const NOTE_WIDTH = 200;

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
  private theme!: ThemeColors;
  private lastTransform = '';
  private groupField: string | null = null;
  interactive = false;
  /** Screen rects notes should stay clear of (e.g. the legend). */
  avoid: { x: number; y: number; w: number; h: number }[] = [];

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
    this.setAxes(this.axes, true);
    this.groupLayer.selectAll('*').remove();
    this.annotationLayer.selectAll('*').remove();
  }

  setAxes(axes: AxisGuide[], force = false) {
    const same = !force && JSON.stringify(axes) === JSON.stringify(this.axes);
    if (same) return;
    this.axes = axes;
    if (this.current) {
      const old = this.current;
      old.attr('class', 'guide-set leaving').style('opacity', '0');
      setTimeout(() => old.remove(), 450);
    }
    const g = this.guideLayer.append('g').attr('class', 'guide-set entering');
    this.current = g;
    for (const axis of axes) this.buildAxis(g, axis);
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
      .attr('font-size', 11.5)
      .attr('text-anchor', axis.orient === 'bottom' ? 'middle' : 'end')
      .attr('dominant-baseline', axis.orient === 'bottom' ? 'hanging' : 'middle')
      .text((d) => d.label);
    a.append('line').attr('class', 'domain').attr('stroke', t.axis).attr('stroke-width', 1);
    const labelFont = `11.5px ${FONT}`;
    a.attr('data-label-width', Math.max(0, ...axis.ticks.map((d) => measure(d.label, labelFont))));
    a.append('text')
      .attr('class', 'axis-title')
      .attr('fill', t.textPrimary)
      .attr('font-size', 12.5)
      .attr('font-weight', 600)
      .attr('text-anchor', 'middle')
      .text(axis.title);
  }

  private positionAxes(t: Transform, width: number, height: number) {
    if (!this.current) return;
    const key = `${t.k},${t.x},${t.y},${width},${height}`;
    if (key === this.lastTransform) return;
    this.lastTransform = key;
    const sx = (v: number) => v * t.k + t.x;
    const sy = (v: number) => v * t.k + t.y;
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
          .attr('y', y + 34);
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
          `translate(${Math.max(14, x - labelW - 22)},${cy}) rotate(-90)`,
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
          .attr('font-size', 12.5)
          .attr('font-weight', 600)
          .attr('fill', th.textPrimary);
        g.append('text')
          .attr('class', 'group-count')
          .attr('text-anchor', 'middle')
          .attr('font-size', 11)
          .attr('y', 15)
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

  private updateAnnotations(placements: AnnotationPlacement[], width: number, height: number) {
    const th = this.theme;
    const titleFont = `600 13px ${FONT}`;
    const bodyFont = `12px ${FONT}`;
    const sel = this.annotationLayer
      .selectAll<SVGGElement, AnnotationPlacement>('g.annotation')
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
          requestAnimationFrame(() => g.attr('class', 'annotation'));
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    const avoid = this.avoid;
    sel.each(function (d) {
      const g = select(this);
      const a = d.annotation;
      // Render caches live on the element itself: a note that leaves and re-enters
      // (slide changes, edit ↔ present) gets a fresh element and must rebuild its text.
      const node = g.node() as NoteElement;
      const drag = node.__drag;
      let dx = drag?.dx ?? a.dx;
      let dy = drag?.dy ?? a.dy;
      // Keep notes on screen: mirror the offset when the note would overflow and the other side fits.
      const size = node.__size;
      if (!drag && size) {
        // Keep notes on screen and clear of the legend: try the offset as set,
        // then mirrored horizontally, vertically, and both.
        const M = 10;
        const fits = (ox: number, oy: number) => {
          const x0 = ox >= 0 ? d.x + ox - 4 : d.x + ox - size.w - 4;
          const x1 = x0 + size.w + 8;
          const y0 = oy >= 0 ? d.y + oy - 6 : d.y + oy - size.h;
          const y1 = y0 + size.h + 8;
          if (x0 < M || y0 < M || x1 > width - M || y1 > height - M) return false;
          return !avoid.some((r) => x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y);
        };
        const options: [number, number][] = [
          [dx, dy],
          [-dx, dy],
          [dx, -dy],
          [-dx, -dy],
        ];
        const best = options.find(([ox, oy]) => fits(ox, oy));
        if (best) [dx, dy] = best;
      }
      g.style('opacity', d.visible ? '1' : '0');

      // Rebuild the text only when content or side changes.
      const side = `${dx >= 0 ? 'r' : 'l'}${dy >= 0 ? 'b' : 't'}`;
      const version = `${a.title}\u0000${a.text}\u0000${side}`;
      const text = g.select<SVGTextElement>('text.note-text');
      if (node.__version !== version) {
        node.__version = version;
        text.selectAll('*').remove();
        const lines: { t: string; title: boolean }[] = [
          ...(a.title ? wrapText(a.title, titleFont, NOTE_WIDTH).map((t) => ({ t, title: true })) : []),
          ...(a.text ? wrapText(a.text, bodyFont, NOTE_WIDTH).map((t) => ({ t, title: false })) : []),
        ];
        const anchor = dx >= 0 ? 'start' : 'end';
        const lineH = 16;
        const total = lines.length * lineH;
        const y0 = dy >= 0 ? 16 : -6 - total + 12;
        lines.forEach((l, i) => {
          text
            .append('tspan')
            .attr('x', 0)
            .attr('y', y0 + i * lineH)
            .attr('text-anchor', anchor)
            .attr('font-size', l.title ? 13 : 12)
            .attr('font-weight', l.title ? 600 : 400)
            .attr('fill', l.title ? th.textPrimary : th.textSecondary)
            .text(l.t || ' ');
        });
        const textWidth = Math.max(40, ...lines.map((l) => measure(l.t, l.title ? titleFont : bodyFont)));
        const w = Math.min(NOTE_WIDTH, textWidth);
        node.__size = { w, h: total + 14 };
        g.select('line.rule')
          .attr('x1', 0)
          .attr('x2', dx >= 0 ? w : -w)
          .attr('y1', 0)
          .attr('y2', 0);
        g.select('rect.hit')
          .attr('x', dx >= 0 ? -4 : -w - 4)
          .attr('y', dy >= 0 ? -6 : -total - 8)
          .attr('width', w + 8)
          .attr('height', total + 14);
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
        .attr('opacity', r > 0 ? 1 : 0);
      g.select('line.connector')
        .attr('x1', d.x + (dx / dist) * r)
        .attr('y1', d.y + (dy / dist) * r)
        .attr('x2', nx)
        .attr('y2', ny)
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
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = start.dx + ev.clientX - start.x;
      const dy = start.dy + ev.clientY - start.y;
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
    this.updateAnnotations(annotations, width, height);
  }
}
