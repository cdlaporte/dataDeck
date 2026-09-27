import { useState } from 'react';
import { dropField, useStore, type DropZone } from '../state/store';
import { FIELD_MIME } from './fieldTypes';

const ZONES: { zone: DropZone; label: string; className: string }[] = [
  { zone: 'x', label: 'X axis', className: 'drop-x' },
  { zone: 'y', label: 'Y axis', className: 'drop-y' },
  { zone: 'color', label: 'Color', className: 'drop-color' },
  { zone: 'alone', label: 'Show on its own', className: 'drop-alone' },
];

/** Targets shown on the stage while a field is dragged from the Data panel. */
export function DropZones() {
  const field = useStore((s) => s.draggingField);
  const [over, setOver] = useState<DropZone | null>(null);
  if (!field) return null;
  return (
    <div className="drop-zones" aria-hidden="true">
      {ZONES.map(({ zone, label, className }) => (
        <div
          key={zone}
          className={`drop-zone ${className}${over === zone ? ' over' : ''}`}
          data-zone={zone}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(zone);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => setOver((z) => (z === zone ? null : z))}
          onDrop={(e) => {
            e.preventDefault();
            const name = e.dataTransfer.getData(FIELD_MIME) || e.dataTransfer.getData('text/plain') || field;
            setOver(null);
            useStore.setState({ draggingField: null });
            dropField(name, zone);
          }}
        >
          <span>
            <b>{label}</b>
            {field}
          </span>
        </div>
      ))}
    </div>
  );
}
