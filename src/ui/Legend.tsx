import * as Popover from '@radix-ui/react-popover';
import { useLayoutEffect, useRef, useState } from 'react';
import { anchorRows } from '../engine/encodings';
import { getEngine } from '../engine/instance';
import { formatAxisValue } from '../engine/layouts/common';
import { CATEGORICAL, readThemeColors } from '../engine/palette';
import { resetCategoryColors, setCategoryColor, useStore } from '../state/store';
import { toggleCategory } from './actions';

export function Legend() {
  const info = useStore((s) => s.layoutInfo);
  const table = useStore((s) => s.table);
  const filters = useStore((s) => s.view.filters);
  const annotations = useStore((s) => s.view.annotations);
  const presenting = useStore((s) => s.mode === 'present');
  const ref = useRef<HTMLElement>(null);

  // Tell the engine where the legend is so annotation notes can steer clear of it.
  useLayoutEffect(() => {
    const engine = getEngine();
    const el = ref.current;
    if (!engine) return;
    if (!el) {
      engine.setAvoidRects([]);
      return;
    }
    const report = () => {
      const stage = engine.container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      engine.setAvoidRects([{ x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }]);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    ro.observe(engine.container);
    return () => {
      ro.disconnect();
      engine.setAvoidRects([]);
    };
  });

  if (!info || !table) return null;
  const { colorLegend: color, sizeLegend: size } = info;
  const highlighted = new Set<number>();
  for (const a of annotations)
    if (a.highlight) for (const r of anchorRows(table, a.anchor)) highlighted.add(r);
  if (color.kind === 'none' && !size && !highlighted.size) return null;

  const excluded = new Set<string>();
  if (color.kind === 'categorical') {
    for (const f of filters)
      if (f.kind === 'categorical' && f.field === color.field) f.exclude.forEach((v) => excluded.add(v));
  }

  return (
    <aside className="legend" aria-label="Legend" ref={ref}>
      {highlighted.size > 0 && (
        <div className="legend-chip" title="An annotation highlights these bubbles; the rest are greyed out">
          <i /> Highlighting {highlighted.size.toLocaleString()}{' '}
          {highlighted.size === 1 ? 'bubble' : 'bubbles'}
        </div>
      )}
      {color.kind === 'categorical' && (
        <div>
          <div className="legend-title">{color.field}</div>
          <div className="legend-items">
            {color.items.map((item) => {
              const isOther = item.label.startsWith('Other (');
              const off = excluded.has(item.label);
              return (
                <div key={item.label} className={`legend-row${off ? ' off' : ''}`}>
                  {presenting || isOther ? (
                    <span className="legend-swatch-btn" aria-hidden="true">
                      <i className="swatch" style={{ background: item.color }} />
                    </span>
                  ) : (
                    <ColorPicker
                      field={color.field}
                      value={item.label}
                      color={item.color}
                      custom={!!item.custom}
                    />
                  )}
                  <button
                    type="button"
                    className={`legend-item${off ? ' off' : ''}`}
                    disabled={presenting || isOther}
                    title={presenting || isOther ? undefined : off ? 'Show' : 'Hide'}
                    onClick={() => toggleCategory(color.field, item.label)}
                  >
                    <span>{item.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
          {!presenting && color.items.some((i) => i.custom) && (
            <button
              type="button"
              className="link legend-reset"
              onClick={() => resetCategoryColors(color.field)}
            >
              Reset colors
            </button>
          )}
        </div>
      )}
      {color.kind === 'sequential' && (
        <div>
          <div className="legend-title">{color.field}</div>
          <div
            className="legend-ramp"
            style={{ background: `linear-gradient(90deg, ${color.stops.join(',')})` }}
          />
          <div className="legend-ramp-labels">
            <span>{formatAxisValue(table.fieldByName[color.field], color.min)}</span>
            <span>{formatAxisValue(table.fieldByName[color.field], color.max)}</span>
          </div>
        </div>
      )}
      {size && (
        <div>
          <div className="legend-title">{size.field}</div>
          <div className="legend-sizes">
            {[0, 0.5, 1].map((t) => {
              const factor = size.rMin + (size.rMax - size.rMin) * t;
              const areaT = (factor ** 2 - size.rMin ** 2) / Math.max(1e-9, size.rMax ** 2 - size.rMin ** 2);
              const value = size.min + (size.max - size.min) * areaT;
              const d = Math.max(4, Math.min(44, factor * info.baseRadiusPx * 2));
              return (
                <div key={t} className="legend-size">
                  <i style={{ width: d, height: d }} />
                  <span>{formatAxisValue(table.fieldByName[size.field], value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

/** A few extra hues beyond the categorical palette. */
const EXTRA_COLORS = ['#1f2937', '#7c8594', '#0e9aa7', '#a0522d'];

/** Legend swatch that opens a colour picker for one category (deck-wide). */
function ColorPicker({
  field,
  value,
  color,
  custom,
}: {
  field: string;
  value: string;
  color: string;
  custom: boolean;
}) {
  const [open, setOpen] = useState(false);
  const choices = [...CATEGORICAL[readThemeColors().name], ...EXTRA_COLORS];
  const current = color.toLowerCase();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="legend-swatch-btn"
          aria-label={`Color for ${value}`}
          title="Change color"
        >
          <i className="swatch" style={{ background: color }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover color-popover"
          side="left"
          align="start"
          sideOffset={8}
          aria-label={`Color for ${value}`}
        >
          <div className="color-popover-title">{value}</div>
          <div className="swatch-row" role="group" aria-label="Colors">
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch-pick"
                style={{ background: c }}
                aria-label={`Use ${c}`}
                aria-pressed={current === c.toLowerCase()}
                onClick={() => {
                  setCategoryColor(field, value, c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="color-popover-row">
            <label className="color-custom">
              <input
                type="color"
                aria-label="Custom color"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
                onChange={(e) => setCategoryColor(field, value, e.target.value)}
              />
              Custom…
            </label>
            <button
              type="button"
              className="btn ghost small"
              disabled={!custom}
              onClick={() => {
                setCategoryColor(field, value, null);
                setOpen(false);
              }}
            >
              Reset
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
