import { useEffect, useMemo, useRef, useState } from 'react';
import { computeVisibility } from '../data/filters';
import { findRows } from '../data/search';
import { getEngine } from '../engine/instance';
import { setSelection, useStore } from '../state/store';
import { IconSearch, IconX } from './icons';

/** Cmd/Ctrl+F: find rows by name (or any text/categorical value) and select them. */
export function FindBox() {
  const open = useStore((s) => s.findOpen);
  if (!open) return null;
  return <FindPanel />;
}

function FindPanel() {
  const table = useStore((s) => s.table)!;
  const filters = useStore((s) => s.view.filters);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => computeVisibility(table, filters), [table, filters]);
  const { hits, total } = useMemo(() => findRows(table, query, 8, visible), [table, query, visible]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    getEngine()?.pulseRow(hits[active]?.row ?? -1);
  }, [hits, active]);
  useEffect(() => () => getEngine()?.pulseRow(-1), []);

  const close = () => useStore.setState({ findOpen: false });
  const pick = (row: number) => {
    setSelection([row]);
    close();
  };
  const pickAll = () => {
    setSelection(findRows(table, query, Infinity, visible).hits.map((h) => h.row));
    close();
  };

  return (
    <div className="find-box" role="dialog" aria-label="Find a data point">
      <div className="find-input">
        <IconSearch size={15} />
        <input
          ref={inputRef}
          value={query}
          placeholder={`Find by ${table.labelField ?? 'name'} or category…`}
          aria-label="Search rows"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              if (e.shiftKey) pickAll();
              else pick(hits[active].row);
            }
          }}
        />
        <button type="button" className="btn icon ghost small" aria-label="Close find" onClick={close}>
          <IconX size={14} />
        </button>
      </div>
      {query.trim() && (
        <div className="find-results" role="listbox">
          {hits.length === 0 && (
            <div className="section-hint find-empty">No matches among visible bubbles.</div>
          )}
          {hits.map((h, i) => (
            <button
              key={h.row}
              type="button"
              role="option"
              aria-selected={i === active}
              className="find-hit"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h.row)}
            >
              <span>{h.value}</span>
              {h.field !== table.labelField && <span className="find-field">{h.field}</span>}
            </button>
          ))}
          {total > 1 && (
            <button type="button" className="find-all link" onClick={pickAll}>
              Select all {total.toLocaleString()} matches <span className="kbd">⇧ Enter</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
