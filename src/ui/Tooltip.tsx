import { useLayoutEffect, useRef, useState } from 'react';
import { formatCell, rowLabel } from '../data/format';
import type { HoverInfo } from '../engine/Engine';
import { useStore } from '../state/store';

export function Tooltip({ hover }: { hover: HoverInfo }) {
  const table = useStore((s) => s.table);
  const view = useStore((s) => s.view);
  const layoutInfo = useStore((s) => s.layoutInfo);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: hover.clientX + 14, top: hover.clientY + 14 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = hover.clientX + 14;
    let top = hover.clientY + 14;
    if (left + width > window.innerWidth - 8) left = hover.clientX - width - 14;
    if (top + height > window.innerHeight - 8) top = hover.clientY - height - 14;
    setPos({ left, top });
  }, [hover.clientX, hover.clientY, hover.row]);

  if (!table) return null;
  const l = view.layout;
  const inView = [
    ...(l.mode === '1d' ? [l.field] : l.mode === '2d' ? [l.x, l.y] : []),
    view.encoding.color,
    view.encoding.size,
  ].filter((f): f is string => !!f && f !== table.labelField);
  const emphasized = [...new Set(inView)];
  const others = table.fields
    .map((f) => f.name)
    .filter((f) => f !== table.labelField && !emphasized.includes(f))
    .slice(0, Math.max(0, 7 - emphasized.length));

  const legend = layoutInfo?.colorLegend;
  let swatch: string | null = null;
  if (legend?.kind === 'categorical') {
    const v = formatCell(table, legend.field, hover.row);
    swatch = legend.items.find((i) => i.label === v)?.color ?? legend.items.find((i) => i.label.startsWith('Other ('))?.color ?? null;
  }

  return (
    <div ref={ref} className="tooltip" style={pos} role="tooltip">
      <div className="tooltip-title">
        {swatch && <i className="swatch" style={{ background: swatch }} />}
        {rowLabel(table, hover.row)}
      </div>
      <dl>
        {emphasized.map((f) => (
          <Row key={f} name={f} value={formatCell(table, f, hover.row)} em />
        ))}
        {others.map((f) => (
          <Row key={f} name={f} value={formatCell(table, f, hover.row)} />
        ))}
      </dl>
    </div>
  );
}

function Row({ name, value, em }: { name: string; value: string; em?: boolean }) {
  return (
    <>
      <dt className={em ? 'em' : undefined}>{name}</dt>
      <dd className={em ? 'em' : undefined}>{value}</dd>
    </>
  );
}
