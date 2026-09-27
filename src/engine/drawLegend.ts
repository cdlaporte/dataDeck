import { formatAxisValue } from './layouts/common';
import type { DataTable } from '../state/types';
import type { LayoutInfo } from './Engine';
import type { ThemeColors } from './palette';

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';

/**
 * Draws the colour / size legend onto a 2D canvas (for exported images),
 * right-aligned at (right, top) in CSS px, scaled by `s`.
 */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  info: LayoutInfo,
  table: DataTable,
  theme: ThemeColors,
  right: number,
  top: number,
  s: number,
) {
  const { colorLegend: color, sizeLegend: size } = info;
  const W = 180;
  const x = right - W;
  let y = top;
  const title = (text: string) => {
    ctx.fillStyle = theme.textPrimary;
    ctx.font = `600 ${11.5 * s}px ${FONT}`;
    ctx.fillText(text, x * s, (y + 12) * s, W * s);
    y += 20;
  };
  const label = (text: string, lx: number, ly: number, align: CanvasTextAlign = 'left') => {
    ctx.fillStyle = theme.textSecondary;
    ctx.font = `${11.5 * s}px ${FONT}`;
    ctx.textAlign = align;
    ctx.fillText(text, lx * s, ly * s, (W - 18) * s);
    ctx.textAlign = 'left';
  };

  if (color.kind === 'categorical') {
    title(color.field);
    for (const item of color.items) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc((x + 5) * s, (y + 5) * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
      label(item.label, x + 16, y + 9);
      y += 19;
    }
    y += 10;
  } else if (color.kind === 'sequential') {
    title(color.field);
    const grad = ctx.createLinearGradient(x * s, 0, (x + 160) * s, 0);
    color.stops.forEach((c, i) => grad.addColorStop(i / (color.stops.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(x * s, y * s, 160 * s, 10 * s);
    const meta = table.fieldByName[color.field];
    label(formatAxisValue(meta, color.min), x, y + 26);
    label(formatAxisValue(meta, color.max), x + 160, y + 26, 'right');
    y += 42;
  }

  if (size) {
    title(size.field);
    const meta = table.fieldByName[size.field];
    let cx = x;
    for (const t of [0, 0.5, 1]) {
      const factor = size.rMin + (size.rMax - size.rMin) * t;
      const areaT = (factor ** 2 - size.rMin ** 2) / Math.max(1e-9, size.rMax ** 2 - size.rMin ** 2);
      const value = size.min + (size.max - size.min) * areaT;
      const r = Math.max(2, Math.min(22, factor * info.baseRadiusPx));
      ctx.strokeStyle = theme.textMuted;
      ctx.lineWidth = 1.25 * s;
      ctx.beginPath();
      ctx.arc((cx + 22) * s, (y + 24 - r) * s, r * s, 0, Math.PI * 2);
      ctx.stroke();
      label(formatAxisValue(meta, value), cx + 22, y + 40, 'center');
      cx += 56;
    }
  }
}
