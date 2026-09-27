import { formatAxisValue } from '../engine/layouts/common';
import { useStore } from '../state/store';
import { toggleCategory } from './actions';

export function Legend() {
  const info = useStore((s) => s.layoutInfo);
  const table = useStore((s) => s.table);
  const filters = useStore((s) => s.view.filters);
  const presenting = useStore((s) => s.mode === 'present');
  if (!info || !table) return null;
  const { colorLegend: color, sizeLegend: size } = info;
  if (color.kind === 'none' && !size) return null;

  const excluded = new Set<string>();
  if (color.kind === 'categorical') {
    for (const f of filters)
      if (f.kind === 'categorical' && f.field === color.field) f.exclude.forEach((v) => excluded.add(v));
  }

  return (
    <aside className="legend" aria-label="Legend">
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
