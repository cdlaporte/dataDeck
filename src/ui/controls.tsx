import * as RSelect from '@radix-ui/react-select';
import * as RSlider from '@radix-ui/react-slider';
import type { FieldMeta, FieldType } from '../state/types';
import { IconChevronDown } from './icons';
import { TYPE_GLYPH, TYPE_LABEL } from './fieldTypes';

export function TypeBadge({
  type,
  onClick,
  title,
}: {
  type: FieldType;
  onClick?: () => void;
  title?: string;
}) {
  const label = title ?? TYPE_LABEL[type];
  if (onClick) {
    return (
      <button
        type="button"
        className={`type-badge ${type}`}
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        {TYPE_GLYPH[type]}
      </button>
    );
  }
  return (
    <span className={`type-badge ${type}`} title={label} aria-label={label}>
      {TYPE_GLYPH[type]}
    </span>
  );
}

const NONE = '__none__';

export function FieldSelect({
  fields,
  value,
  onChange,
  placeholder = 'Choose a field',
  allowNone,
  noneLabel = 'None',
  ariaLabel,
}: {
  fields: FieldMeta[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  ariaLabel?: string;
}) {
  const groups: FieldType[] = ['quantitative', 'date', 'categorical'];
  return (
    <RSelect.Root
      value={value ?? (allowNone ? NONE : undefined)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <RSelect.Trigger className="select-trigger" aria-label={ariaLabel}>
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <IconChevronDown size={14} />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="select-content" position="popper" sideOffset={4}>
          <RSelect.Viewport className="select-viewport">
            {allowNone && (
              <>
                <RSelect.Item value={NONE} className="select-item">
                  <RSelect.ItemText>{noneLabel}</RSelect.ItemText>
                </RSelect.Item>
                <RSelect.Separator className="select-separator" />
              </>
            )}
            {groups.map((type) => {
              const list = fields.filter((f) => f.type === type);
              if (!list.length) return null;
              return (
                <RSelect.Group key={type}>
                  <RSelect.Label className="select-label">{TYPE_LABEL[type]}</RSelect.Label>
                  {list.map((f) => (
                    <RSelect.Item key={f.name} value={f.name} className="select-item">
                      <TypeBadge type={f.type} />
                      <RSelect.ItemText>{f.name}</RSelect.ItemText>
                    </RSelect.Item>
                  ))}
                </RSelect.Group>
              );
            })}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  ariaLabel,
}: {
  value: number[];
  min: number;
  max: number;
  step?: number;
  onChange?: (v: number[]) => void;
  onCommit?: (v: number[]) => void;
  ariaLabel?: string;
}) {
  return (
    <RSlider.Root
      className="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={onChange}
      onValueCommit={onCommit}
      minStepsBetweenThumbs={0}
    >
      <RSlider.Track className="slider-track">
        <RSlider.Range className="slider-range" />
      </RSlider.Track>
      {value.map((_, i) => (
        <RSlider.Thumb key={i} className="slider-thumb" aria-label={ariaLabel} />
      ))}
    </RSlider.Root>
  );
}

/** Tiny histogram / category bar sparkline for the field list. */
export function Sparkline({
  field,
  width = 64,
  height = 22,
}: {
  field: FieldMeta;
  width?: number;
  height?: number;
}) {
  let bars: number[] = [];
  if (field.histogram) bars = field.histogram.map((b) => b.count);
  else if (field.categories) bars = field.categories.slice(0, 12).map((c) => c.count);
  if (!bars.length) return <svg className="field-spark" width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...bars);
  const gap = 1;
  const w = (width - gap * (bars.length - 1)) / bars.length;
  return (
    <svg className="field-spark" width={width} height={height} aria-hidden="true">
      {bars.map((b, i) => {
        const h = Math.max(1, (b / max) * (height - 2));
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={height - h}
            width={Math.max(0.5, w)}
            height={h}
            rx={Math.min(1.5, w / 2)}
            fill={`var(--type-${field.type})`}
            opacity={0.55}
          />
        );
      })}
    </svg>
  );
}
