import { useState } from 'react';
import { getEngine } from '../engine/instance';
import { MOTION_LABEL, type MotionPreset } from '../engine/motion';
import { overlapAllowed, referenceAvailable, trendAvailable } from '../engine/layouts';
import { isNumericType } from '../data/profile';
import {
  dimensionFields,
  removeAnnotation,
  setEncoding,
  setLayout,
  setOverlap,
  setLayoutMode,
  setReference,
  setTrend,
  useStore,
} from '../state/store';
import type { DataTable, LayoutMode, LayoutSpec, ReferenceKind, TsneParams } from '../state/types';
import { FieldSelect, Slider, TypeBadge } from './controls';
import {
  Icon1D,
  Icon2D,
  IconCluster,
  IconNote,
  IconPanelRight,
  IconRefresh,
  IconSwap,
  IconTrash,
  IconTsne,
} from './icons';

const MODES: { mode: LayoutMode; label: string; icon: typeof Icon1D; hint: string }[] = [
  { mode: 'cluster', label: 'Cluster', icon: IconCluster, hint: 'All rows in one group' },
  { mode: '1d', label: '1D', icon: Icon1D, hint: 'One dimension' },
  { mode: '2d', label: '2D', icon: Icon2D, hint: 'Two dimensions (scatter)' },
  { mode: 'tsne', label: 't-SNE', icon: IconTsne, hint: 'Three or more dimensions' },
];

export function ViewPanel() {
  const open = useStore((s) => s.rightOpen);
  const table = useStore((s) => s.table);
  const view = useStore((s) => s.view);
  if (!table) return null;
  const dims = dimensionFields(table);
  const layout = view.layout;

  return (
    <aside className={`panel right${open ? '' : ' collapsed'}`} aria-label="View panel">
      <div className="panel-header">
        <span className="panel-title">View</span>
        <button
          type="button"
          className="btn icon ghost small"
          aria-label={open ? 'Collapse view panel' : 'Expand view panel'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => useStore.setState({ rightOpen: !open })}
        >
          <IconPanelRight size={15} />
        </button>
      </div>
      <div className="panel-body">
        <section className="section">
          <div className="section-head">
            <span className="section-title">Layout</span>
          </div>
          <div className="segmented" role="group" aria-label="Layout">
            {MODES.map(({ mode, label, icon: I, hint }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={layout.mode === mode}
                title={hint}
                onClick={() => setLayoutMode(mode)}
              >
                <I size={18} />
                {label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            {layout.mode === 'cluster' && (
              <div className="section-hint">
                Every row is a bubble. Pick a layout above, or click a field on the left to spread the data
                along it.
              </div>
            )}
            {layout.mode === '1d' && (
              <div className="field-row">
                <label className="label">Field</label>
                <div className="select-with-toggle">
                  <FieldSelect
                    fields={dims}
                    value={layout.field}
                    ariaLabel="Layout field"
                    onChange={(v) => v && setLayout({ mode: '1d', field: v })}
                  />
                  <LogToggle
                    field={layout.field}
                    on={!!layout.log}
                    axis="axis"
                    onChange={(log) => setLayout({ ...layout, log })}
                  />
                </div>
              </div>
            )}
            {layout.mode === '2d' && <TwoDControls layout={layout} dims={dims} />}
            {layout.mode === 'tsne' && <TsneControls layout={layout} />}
            {overlapAllowed(layout, table) && (
              <label
                className="switch-row"
                title="Turn collisions off so bubbles sit exactly on their values"
              >
                <input
                  type="checkbox"
                  role="switch"
                  checked={!!view.overlap}
                  onChange={(e) => setOverlap(e.target.checked)}
                />
                <span>Let bubbles overlap</span>
              </label>
            )}
            {trendAvailable(layout, table) && (
              <label className="switch-row" title="Least-squares line and the correlation r">
                <input
                  type="checkbox"
                  role="switch"
                  checked={!!view.trend}
                  onChange={(e) => setTrend(e.target.checked)}
                />
                <span>Trend line (r)</span>
              </label>
            )}
            {referenceAvailable(layout, table) && (
              <ReferenceControl layout={layout} table={table} value={view.reference} />
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-title">Encoding</span>
          </div>
          <div className="field-row">
            <label className="label">Color</label>
            <FieldSelect
              fields={dims}
              value={view.encoding.color}
              allowNone
              noneLabel="Single color"
              ariaLabel="Color field"
              onChange={(v) => setEncoding({ color: v })}
            />
          </div>
          <div className="field-row">
            <label className="label">Size</label>
            <FieldSelect
              fields={dims.filter((f) => f.type === 'quantitative')}
              value={view.encoding.size}
              allowNone
              noneLabel="Uniform size"
              ariaLabel="Size field"
              onChange={(v) => setEncoding({ size: v })}
            />
          </div>
        </section>

        <AnnotationsSection />
        <MotionSection />
      </div>
    </aside>
  );
}

const REFERENCE_OPTIONS: [string, ReferenceKind | null][] = [
  ['None', null],
  ['Mean', 'mean'],
  ['Median', 'median'],
];

/** Mean / median reference lines; per category when one 2D axis is categorical. */
function ReferenceControl({
  layout,
  table,
  value,
}: {
  layout: LayoutSpec;
  table: DataTable;
  value: ReferenceKind | undefined;
}) {
  const numeric = (f: string) => {
    const t = table.fieldByName[f]?.type;
    return !!t && isNumericType(t);
  };
  const perCategory = layout.mode === '2d' && numeric(layout.x) !== numeric(layout.y);
  return (
    <div className="field-row reference-row">
      <label className="label">
        Reference line
        {perCategory && <span className="label-hint"> · one per category</span>}
      </label>
      <div className="segmented mini" role="group" aria-label="Reference line">
        {REFERENCE_OPTIONS.map(([label, kind]) => (
          <button
            key={label}
            type="button"
            aria-pressed={(value ?? null) === kind}
            onClick={() => setReference(kind)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TwoDControls({
  layout,
  dims,
}: {
  layout: Extract<LayoutSpec, { mode: '2d' }>;
  dims: ReturnType<typeof dimensionFields>;
}) {
  return (
    <>
      <div className="field-row">
        <label className="label">X axis</label>
        <div className="select-with-toggle">
          <FieldSelect
            fields={dims}
            value={layout.x}
            ariaLabel="X axis field"
            onChange={(v) => v && setLayout({ ...layout, x: v, logX: false })}
          />
          <LogToggle
            field={layout.x}
            on={!!layout.logX}
            axis="X axis"
            onChange={(logX) => setLayout({ ...layout, logX })}
          />
        </div>
      </div>
      <div className="field-row">
        <label
          className="label"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          Y axis
          <button
            type="button"
            className="link"
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
            onClick={() =>
              setLayout({ ...layout, x: layout.y, y: layout.x, logX: layout.logY, logY: layout.logX })
            }
          >
            <IconSwap size={12} /> Swap
          </button>
        </label>
        <div className="select-with-toggle">
          <FieldSelect
            fields={dims}
            value={layout.y}
            ariaLabel="Y axis field"
            onChange={(v) => v && setLayout({ ...layout, y: v, logY: false })}
          />
          <LogToggle
            field={layout.y}
            on={!!layout.logY}
            axis="Y axis"
            onChange={(logY) => setLayout({ ...layout, logY })}
          />
        </div>
      </div>
    </>
  );
}

/** "Log" scale toggle, shown for quantitative fields only. */
function LogToggle({
  field,
  on,
  axis,
  onChange,
}: {
  field: string;
  on: boolean;
  axis: string;
  onChange: (on: boolean) => void;
}) {
  const type = useStore((s) => s.table?.fieldByName[field]?.type);
  if (type !== 'quantitative') return null;
  return (
    <button
      type="button"
      className="btn small log-toggle"
      aria-pressed={on}
      aria-label={`Log scale for ${axis}`}
      title="Logarithmic scale — spreads out skewed data"
      onClick={() => onChange(!on)}
    >
      Log
    </button>
  );
}

function TsneControls({ layout }: { layout: Extract<LayoutSpec, { mode: 'tsne' }> }) {
  const table = useStore((s) => s.table)!;
  const status = useStore((s) => s.tsneStatus);
  const [draft, setDraft] = useState<TsneParams>(layout.params);
  const [lastParams, setLastParams] = useState(layout.params);
  if (layout.params !== lastParams) {
    setLastParams(layout.params);
    setDraft(layout.params);
  }
  const dims = dimensionFields(table);
  const selected = new Set(layout.fields);
  const commit = (params: TsneParams) => setLayout({ ...layout, params, coords: undefined });
  const toggle = (name: string) => {
    const fields = selected.has(name) ? layout.fields.filter((f) => f !== name) : [...layout.fields, name];
    setLayout({ ...layout, fields, coords: undefined });
  };

  const param = (
    key: keyof TsneParams,
    label: string,
    min: number,
    max: number,
    step: number,
    hint: string,
  ) => (
    <div className="param-row" title={hint}>
      <span className="label">
        {label}
        <span className="param-value">{draft[key]}</span>
      </span>
      <div style={{ gridColumn: '1 / -1' }}>
        <Slider
          value={[draft[key]]}
          min={min}
          max={max}
          step={step}
          ariaLabel={label}
          onChange={([v]) => setDraft({ ...draft, [key]: v })}
          onCommit={([v]) => commit({ ...draft, [key]: v })}
        />
      </div>
    </div>
  );

  return (
    <>
      <div className="field-row">
        <label className="label">
          Dimensions <span style={{ color: 'var(--text-muted)' }}>({layout.fields.length} selected)</span>
        </label>
        <div className="check-list" style={{ maxHeight: 200 }}>
          {dims.map((f) => (
            <label
              key={f.name}
              className="check-item"
              style={{ gridTemplateColumns: '16px 20px minmax(0,1fr)' }}
            >
              <input type="checkbox" checked={selected.has(f.name)} onChange={() => toggle(f.name)} />
              <TypeBadge type={f.type} />
              <span title={f.name}>{f.name}</span>
            </label>
          ))}
        </div>
        <div className="filter-links">
          <button
            type="button"
            className="link"
            onClick={() =>
              setLayout({
                ...layout,
                fields: dims.filter((f) => isNumericType(f.type)).map((f) => f.name),
                coords: undefined,
              })
            }
          >
            Numeric only
          </button>
          <button
            type="button"
            className="link"
            onClick={() => setLayout({ ...layout, fields: dims.map((f) => f.name), coords: undefined })}
          >
            All
          </button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {param(
          'perplexity',
          'Perplexity',
          2,
          100,
          1,
          'Roughly the number of neighbours each point considers. Low = local detail, high = global structure.',
        )}
        {param(
          'epsilon',
          'Learning rate',
          1,
          500,
          1,
          'Step size of the optimisation. Higher converges faster but can be unstable.',
        )}
        {param('iterations', 'Iterations', 100, 3000, 50, 'How long to optimise.')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            getEngine()?.invalidateTsne();
            setLayout({ ...layout, coords: undefined, params: { ...layout.params } });
          }}
        >
          <IconRefresh size={14} /> Re-run
        </button>
        <span className="section-hint">
          {status.state === 'done' && 'Converged'}
          {status.state === 'error' && status.message}
          {status.state === 'running' && `Running · ${status.iteration}/${status.total}`}
          {status.state === 'paused' && 'Paused'}
          {status.state === 'preparing' && 'Finding neighbours…'}
        </span>
      </div>
    </>
  );
}

function AnnotationsSection() {
  const annotations = useStore((s) => s.view.annotations);
  return (
    <section className="section">
      <div className="section-head">
        <span className="section-title">Annotations</span>
        <button type="button" className="btn small" onClick={() => useStore.setState({ tool: 'annotate' })}>
          <IconNote size={14} /> Add
        </button>
      </div>
      {annotations.length === 0 && (
        <div className="section-hint">Notes stay attached to a bubble or group as the layout changes.</div>
      )}
      <div className="field-list">
        {annotations.map((a) => (
          <div key={a.id} className="field-item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <button
              type="button"
              className="field-name"
              onClick={() => useStore.setState({ editingAnnotationId: a.id })}
            >
              {a.title || 'Untitled note'}
              <span className="field-meta">
                {a.anchor.kind === 'point'
                  ? 'On a bubble'
                  : a.anchor.kind === 'group'
                    ? `On group “${a.anchor.value}”`
                    : a.anchor.kind === 'rows'
                      ? `On ${a.anchor.rows.length.toLocaleString()} selected rows`
                      : a.style === 'text'
                        ? 'Text box'
                        : 'Free'}
              </span>
            </button>
            <button
              type="button"
              className="btn icon small ghost danger"
              aria-label="Delete annotation"
              onClick={() => removeAnnotation(a.id)}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MotionSection() {
  const motion = useStore((s) => s.motion);
  return (
    <section className="section">
      <div className="section-head">
        <span className="section-title">Motion</span>
      </div>
      <div className="segmented" role="group" aria-label="Motion">
        {(Object.keys(MOTION_LABEL) as MotionPreset[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={motion === m}
            onClick={() => useStore.setState({ motion: m })}
          >
            {MOTION_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="section-hint motion-hint">
        {motion === 'calm' && 'Slow, gentle transitions. Bubbles come fully to rest.'}
        {motion === 'balanced' && 'Smooth transitions that settle quickly.'}
        {motion === 'lively' && 'Snappy transitions with a little life at rest.'}
      </div>
    </section>
  );
}
