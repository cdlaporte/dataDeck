import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { MISSING_KEY } from '../data/filters';
import { formatDate, formatNumber } from '../data/format';
import { makeId } from '../data/parse';
import { isNumericType } from '../data/profile';
import {
  clearFilters,
  removeFilter,
  setEncoding,
  setFieldType,
  setLayout,
  upsertFilter,
  useStore,
} from '../state/store';
import type { FieldMeta, FieldType, Filter } from '../state/types';
import { Slider, Sparkline, TypeBadge } from './controls';
import { TYPE_GLYPH, TYPE_LABEL } from './fieldTypes';
import { IconFilter, IconPalette, IconPanelLeft, IconPlus, IconX } from './icons';

export function DataPanel() {
  const open = useStore((s) => s.leftOpen);
  const table = useStore((s) => s.table);
  const dataset = useStore((s) => s.dataset);
  const filters = useStore((s) => s.view.filters);
  if (!table || !dataset) return null;

  return (
    <aside className={`panel left${open ? '' : ' collapsed'}`} aria-label="Data panel">
      <div className="panel-header">
        <span className="panel-title">Data</span>
        <button
          type="button"
          className="btn icon ghost small"
          aria-label={open ? 'Collapse data panel' : 'Expand data panel'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => useStore.setState({ leftOpen: !open })}
        >
          <IconPanelLeft size={15} />
        </button>
      </div>
      <div className="panel-body">
        <section className="section">
          <div className="section-head">
            <span className="section-title">Fields</span>
            <span className="section-hint">
              {table.rowCount.toLocaleString()} rows · {table.fields.length} cols
            </span>
          </div>
          <div className="field-list">
            {table.fields.map((f) => (
              <FieldItem key={f.name} field={f} />
            ))}
          </div>
        </section>
        <section className="section">
          <div className="section-head">
            <span className="section-title">Filters</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {filters.length > 0 && (
                <button type="button" className="link" onClick={clearFilters}>
                  Clear all
                </button>
              )}
              <AddFilter fields={table.fields} />
            </div>
          </div>
          {filters.length === 0 && <div className="section-hint">No filters. All rows are shown.</div>}
          {filters.map((f) => (
            <FilterCard key={f.id} filter={f} meta={table.fieldByName[f.field]} />
          ))}
        </section>
      </div>
    </aside>
  );
}

function describe(f: FieldMeta): string {
  const missing = f.missing ? ` · ${f.missing.toLocaleString()} missing` : '';
  if (f.type === 'quantitative' && f.min !== undefined)
    return `${formatNumber(f.min, f)} – ${formatNumber(f.max!, f)}${missing}`;
  if (f.type === 'date' && f.min !== undefined)
    return `${formatDate(f.min)} – ${formatDate(f.max!)}${missing}`;
  return `${f.distinct.toLocaleString()} ${f.type === 'text' ? 'unique' : 'categories'}${missing}`;
}

function newFilter(f: FieldMeta): Filter | null {
  if (isNumericType(f.type) && f.min !== undefined && f.max !== undefined) {
    return { id: makeId(), kind: 'range', field: f.name, min: f.min, max: f.max };
  }
  if (f.type === 'categorical') return { id: makeId(), kind: 'categorical', field: f.name, exclude: [] };
  return null;
}

function FieldItem({ field }: { field: FieldMeta }) {
  const layout = useStore((s) => s.view.layout);
  const active =
    (layout.mode === '1d' && layout.field === field.name) ||
    (layout.mode === '2d' && (layout.x === field.name || layout.y === field.name));
  const usable = field.type !== 'text' && field.distinct > 0;
  return (
    <div className={`field-item${active ? ' active' : ''}`}>
      <TypeMenu field={field} />
      <button
        type="button"
        className="field-name"
        disabled={!usable}
        title={
          usable
            ? `Show “${field.name}” on its own`
            : 'Text fields can’t be laid out — change the type to use it'
        }
        onClick={() => setLayout({ mode: '1d', field: field.name })}
      >
        {field.name}
        <span className="field-meta">{describe(field)}</span>
      </button>
      <Sparkline field={field} />
      {usable && (
        <div className="field-actions">
          <button
            type="button"
            className="btn icon small ghost"
            title={`Color by ${field.name}`}
            aria-label={`Color by ${field.name}`}
            onClick={() => setEncoding({ color: field.name })}
          >
            <IconPalette size={14} />
          </button>
          <button
            type="button"
            className="btn icon small ghost"
            title={`Filter by ${field.name}`}
            aria-label={`Filter by ${field.name}`}
            onClick={() => {
              const f = newFilter(field);
              if (f) upsertFilter(f);
            }}
          >
            <IconFilter size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function TypeMenu({ field }: { field: FieldMeta }) {
  const [open, setOpen] = useState(false);
  const types: FieldType[] = ['quantitative', 'categorical', 'date', 'text'];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`type-badge ${field.type}`}
          title={`${TYPE_LABEL[field.type]} — click to change`}
          aria-label={`${field.name} type: ${TYPE_LABEL[field.type]}. Change type`}
        >
          {TYPE_GLYPH[field.type]}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" side="right" align="start" sideOffset={6}>
          <div className="select-label">Treat “{field.name}” as</div>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={field.type === t}
              className="menu-item"
              onClick={() => {
                setFieldType(field.name, t === field.inferredType ? null : t);
                setOpen(false);
              }}
            >
              <TypeBadge type={t} />
              {TYPE_LABEL[t]}
              {t === field.inferredType && (
                <span className="section-hint" style={{ marginLeft: 'auto' }}>
                  detected
                </span>
              )}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AddFilter({ fields }: { fields: FieldMeta[] }) {
  const [open, setOpen] = useState(false);
  const options = fields.filter((f) => f.type !== 'text' && f.distinct > 0);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="btn small">
          <IconPlus size={14} /> Add
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" side="bottom" align="end" sideOffset={6}>
          {options.map((f) => (
            <button
              key={f.name}
              type="button"
              className="menu-item"
              onClick={() => {
                const filter = newFilter(f);
                if (filter) upsertFilter(filter);
                setOpen(false);
              }}
            >
              <TypeBadge type={f.type} />
              {f.name}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterCard({ filter, meta }: { filter: Filter; meta: FieldMeta | undefined }) {
  if (!meta) return null;
  return (
    <div className="filter-card">
      <div className="filter-card-head">
        <TypeBadge type={meta.type} />
        <span>{meta.name}</span>
        <button
          type="button"
          className="btn icon small ghost"
          aria-label={`Remove ${meta.name} filter`}
          onClick={() => removeFilter(filter.id)}
        >
          <IconX size={14} />
        </button>
      </div>
      {filter.kind === 'categorical' ? (
        <CategoryFilter filter={filter} meta={meta} />
      ) : (
        <RangeFilter filter={filter} meta={meta} />
      )}
    </div>
  );
}

function CategoryFilter({
  filter,
  meta,
}: {
  filter: Extract<Filter, { kind: 'categorical' }>;
  meta: FieldMeta;
}) {
  const cats = [...(meta.categories ?? [])];
  if (meta.missing) cats.push({ value: MISSING_KEY, count: meta.missing });
  const excluded = new Set(filter.exclude);
  const toggle = (v: string) => {
    const next = new Set(excluded);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    upsertFilter({ ...filter, exclude: [...next] });
  };
  return (
    <>
      <div className="check-list">
        {cats.slice(0, 300).map((c) => (
          <label key={c.value} className="check-item">
            <input type="checkbox" checked={!excluded.has(c.value)} onChange={() => toggle(c.value)} />
            <span title={c.value}>{c.value}</span>
            <span className="count">{c.count.toLocaleString()}</span>
          </label>
        ))}
      </div>
      <div className="filter-links">
        <button type="button" className="link" onClick={() => upsertFilter({ ...filter, exclude: [] })}>
          All
        </button>
        <button
          type="button"
          className="link"
          onClick={() => upsertFilter({ ...filter, exclude: cats.map((c) => c.value) })}
        >
          None
        </button>
      </div>
    </>
  );
}

function RangeFilter({ filter, meta }: { filter: Extract<Filter, { kind: 'range' }>; meta: FieldMeta }) {
  const lo = meta.min ?? 0;
  const hi = meta.max ?? 1;
  const fmt = (v: number) => (meta.type === 'date' ? formatDate(v) : formatNumber(v, meta));
  const step = meta.type === 'date' ? 86400000 : meta.isInteger ? 1 : (hi - lo) / 200 || 1;
  const hist = meta.histogram ?? [];
  const maxCount = Math.max(1, ...hist.map((b) => b.count));
  const W = 240;
  const H = 34;
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * W;
  return (
    <>
      <svg className="range-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {hist.map((b, i) => {
          const inside = b.x1 >= filter.min && b.x0 <= filter.max;
          const h = Math.max(1, (b.count / maxCount) * (H - 2));
          return (
            <rect
              key={i}
              x={x(b.x0) + 0.5}
              y={H - h}
              width={Math.max(0.5, x(b.x1) - x(b.x0) - 1)}
              height={h}
              rx={1}
              fill={inside ? 'var(--accent)' : 'var(--border-strong)'}
              opacity={inside ? 0.75 : 0.6}
            />
          );
        })}
      </svg>
      <Slider
        value={[filter.min, filter.max]}
        min={lo}
        max={hi}
        step={step}
        ariaLabel={`${meta.name} range`}
        onChange={([min, max]) => upsertFilter({ ...filter, min, max })}
      />
      <div className="range-values">
        <span>{fmt(filter.min)}</span>
        <span>{fmt(filter.max)}</span>
      </div>
    </>
  );
}
