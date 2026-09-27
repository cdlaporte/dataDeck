import { useLayoutEffect, useRef } from 'react';
import { anchorRows } from '../engine/encodings';
import { getEngine } from '../engine/instance';
import { formatAxisValue } from '../engine/layouts/common';
import { useStore } from '../state/store';
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
                <button
                  key={item.label}
                  type="button"
                  className={`legend-item${off ? ' off' : ''}`}
                  disabled={presenting || isOther}
                  title={presenting || isOther ? undefined : off ? 'Show' : 'Hide'}
                  onClick={() => toggleCategory(color.field, item.label)}
                >
                  <i className="swatch" style={{ background: item.color }} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
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
