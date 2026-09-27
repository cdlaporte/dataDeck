import { buildTable } from '../data/profile';
import type { AppState } from './store';

/** The undoable part of the app state: the document, not transient UI. */
type Doc = Pick<AppState, 'view' | 'slides' | 'activeSlideId' | 'fieldOverrides'>;

const COALESCE_MS = 600;
const LIMIT = 100;

let undoStack: Doc[] = [];
let redoStack: Doc[] = [];
let suppress = 0;
let lastRecorded = -Infinity;

type Store = {
  getState(): AppState;
  setState(partial: Partial<AppState>): void;
  subscribe(listener: (s: AppState, prev: AppState) => void): () => void;
};
let store: Store | null = null;

/** Runs `fn` without recording its state changes as undo steps. */
export function withoutHistory(fn: () => void) {
  suppress++;
  try {
    fn();
  } finally {
    suppress--;
  }
}

const docOf = (s: AppState): Doc => ({
  view: s.view,
  slides: s.slides,
  activeSlideId: s.activeSlideId,
  fieldOverrides: s.fieldOverrides,
});

/** A view change that only moved the camera (pan / zoom) is not an undo step. */
function cameraOnly(a: AppState['view'], b: AppState['view']) {
  return (
    a.layout === b.layout &&
    a.encoding === b.encoding &&
    a.filters === b.filters &&
    a.annotations === b.annotations &&
    a.title === b.title &&
    a.caption === b.caption &&
    a.overlap === b.overlap
  );
}

function publish() {
  store?.setState({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  lastRecorded = -Infinity;
  publish();
}

export function initHistory(s: Store, now: () => number = () => Date.now()) {
  store = s;
  s.subscribe((next, prev) => {
    if (suppress) return;
    if (next.dataset !== prev.dataset) return clearHistory();
    // Presenting swaps views in and out; those aren't edits.
    if (next.mode === 'present' || prev.mode === 'present') return;
    const changed =
      (next.view !== prev.view && !cameraOnly(next.view, prev.view)) ||
      next.slides !== prev.slides ||
      next.activeSlideId !== prev.activeSlideId ||
      next.fieldOverrides !== prev.fieldOverrides;
    if (!changed) return;
    const t = now();
    // Bursts (typing, dragging a slider or a note) collapse into one step.
    if (t - lastRecorded > COALESCE_MS || undoStack.length === 0) {
      undoStack.push(docOf(prev));
      if (undoStack.length > LIMIT) undoStack.shift();
    }
    lastRecorded = t;
    if (redoStack.length) redoStack = [];
    publish();
  });
}

function apply(doc: Doc) {
  if (!store) return;
  const s = store.getState();
  const patch: Partial<AppState> = { ...doc, editingAnnotationId: null, selection: [] };
  if (doc.fieldOverrides !== s.fieldOverrides && s.dataset)
    patch.table = buildTable(s.dataset, doc.fieldOverrides);
  withoutHistory(() => store!.setState(patch));
  lastRecorded = -Infinity;
}

export function undo() {
  const doc = undoStack.pop();
  if (!doc || !store) return;
  redoStack.push(docOf(store.getState()));
  apply(doc);
  publish();
}

export function redo() {
  const doc = redoStack.pop();
  if (!doc || !store) return;
  undoStack.push(docOf(store.getState()));
  apply(doc);
  publish();
}
