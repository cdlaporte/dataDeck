import { annotateSelection, clearSelection, excludeSelection, keepSelection, useStore } from '../state/store';
import { getEngine } from '../engine/instance';
import { IconFilter, IconNote, IconTrash, IconX } from './icons';

/** Floating actions for the current lasso selection. */
export function SelectionBar() {
  const count = useStore((s) => s.selection.length);
  if (!count) return null;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions">
      <span className="selection-count">
        <strong>{count.toLocaleString()}</strong> selected
      </span>
      <span className="sep" />
      <button
        type="button"
        className="btn ghost small"
        title="Keep only the selected bubbles (drill in)"
        onClick={keepSelection}
      >
        <IconFilter size={14} /> Keep only
      </button>
      <button
        type="button"
        className="btn ghost small"
        title="Hide the selected bubbles"
        onClick={excludeSelection}
      >
        <IconTrash size={14} /> Exclude
      </button>
      <button
        type="button"
        className="btn ghost small"
        title="Add a note around the selection"
        onClick={() => {
          const rows = useStore.getState().selection;
          annotateSelection(getEngine()?.subjectRadius({ kind: 'rows', rows }) ?? 0);
        }}
      >
        <IconNote size={14} /> Annotate
      </button>
      <button
        type="button"
        className="btn icon ghost small"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        onClick={clearSelection}
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
