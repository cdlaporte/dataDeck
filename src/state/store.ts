import { create } from 'zustand';
import { makeId } from '../data/parse';
import { buildTable, isNumericType } from '../data/profile';
import type { LayoutInfo, Tool, TsneStatus } from '../engine/Engine';
import type { MotionPreset } from '../engine/motion';
import { withoutHistory } from './history';
import {
  DEFAULT_TSNE,
  defaultView,
  type Annotation,
  type DataTable,
  type Dataset,
  type Deck,
  type Encoding,
  type FieldType,
  type Filter,
  type LayoutMode,
  type LayoutSpec,
  type Slide,
  type ViewState,
} from './types';

export type ThemePref = 'system' | 'light' | 'dark';

export interface AppState {
  deckName: string;
  dataset: Dataset | null;
  table: DataTable | null;
  fieldOverrides: Record<string, FieldType>;
  view: ViewState;
  slides: Slide[];
  activeSlideId: string | null;

  mode: 'edit' | 'present';
  presentIndex: number;
  tool: Tool;
  editingAnnotationId: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
  theme: ThemePref;
  motion: MotionPreset;
  /** Lasso selection (row indices). Transient: not part of the view or slides. */
  selection: number[];
  /** Field being dragged from the Data panel (shows the stage drop zones). */
  draggingField: string | null;
  findOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Slide strip shows numbered chips instead of previews. */
  stripCompact: boolean;
  /** Previews are being redrawn (e.g. after a theme change). */
  refreshingThumbnails: boolean;
  /** Export progress, e.g. "Rendering slide 2 / 5" (null when idle). */
  exporting: string | null;
  layoutInfo: LayoutInfo | null;
  tsneStatus: TsneStatus;
  /** Restored from IndexedDB (or nothing to restore). */
  hydrated: boolean;
  error: string | null;
}

const initial: AppState = {
  deckName: 'Untitled deck',
  dataset: null,
  table: null,
  fieldOverrides: {},
  view: defaultView(),
  slides: [],
  activeSlideId: null,
  mode: 'edit',
  presentIndex: 0,
  tool: 'select',
  editingAnnotationId: null,
  leftOpen: true,
  rightOpen: true,
  theme: 'system',
  motion: 'balanced',
  selection: [],
  draggingField: null,
  findOpen: false,
  canUndo: false,
  canRedo: false,
  exporting: null,
  stripCompact: false,
  refreshingThumbnails: false,
  layoutInfo: null,
  tsneStatus: { state: 'idle', iteration: 0, total: 0 },
  hydrated: false,
  error: null,
};

export const useStore = create<AppState>()(() => ({ ...initial }));

const get = useStore.getState;
const set = useStore.setState;

export function clone<T>(v: T): T {
  return structuredClone(v);
}

// ---------------------------------------------------------------------------
// Field helpers

export function dimensionFields(table: DataTable | null, types?: FieldType[]) {
  if (!table) return [];
  return table.fields.filter(
    (f) => f.type !== 'text' && f.distinct > 0 && (!types || types.includes(f.type)),
  );
}

/** A pleasant first view: colour by a small categorical field when there is one. */
function initialView(table: DataTable): ViewState {
  const view = defaultView();
  const cat = table.fields.find((f) => f.type === 'categorical' && f.distinct >= 2 && f.distinct <= 8);
  view.encoding.color = cat?.name ?? null;
  return view;
}

/** Default layout spec for a mode, reusing fields from the current layout where possible. */
export function layoutForMode(mode: LayoutMode, table: DataTable, current: LayoutSpec): LayoutSpec {
  const dims = dimensionFields(table);
  const numeric = dims.filter((f) => isNumericType(f.type));
  const prevFields =
    current.mode === '1d' ? [current.field] : current.mode === '2d' ? [current.x, current.y] : [];
  switch (mode) {
    case 'cluster':
      return { mode };
    case '1d':
      return { mode, field: prevFields[0] ?? numeric[0]?.name ?? dims[0]?.name ?? '' };
    case '2d': {
      const x = prevFields[0] ?? numeric[0]?.name ?? dims[0]?.name ?? '';
      const y =
        prevFields[1] ?? numeric.find((f) => f.name !== x)?.name ?? dims.find((f) => f.name !== x)?.name ?? x;
      return { mode, x, y };
    }
    case 'tsne': {
      const fields = (numeric.length >= 2 ? numeric : dims).slice(0, 12).map((f) => f.name);
      return { mode, fields, params: { ...DEFAULT_TSNE } };
    }
  }
}

/** Drops references to fields that no longer exist or no longer fit their slot. */
export function sanitizeView(view: ViewState, table: DataTable): ViewState {
  const v = clone(view);
  const ok = (name: string | null | undefined) =>
    !!name && !!table.fieldByName[name] && table.fieldByName[name].type !== 'text';
  const l = v.layout;
  if ((l.mode === '1d' && !ok(l.field)) || (l.mode === '2d' && (!ok(l.x) || !ok(l.y))))
    v.layout = { mode: 'cluster' };
  if (l.mode === 'tsne') {
    const fields = l.fields.filter(ok);
    if (fields.length !== l.fields.length) v.layout = { ...l, fields, coords: undefined };
  }
  if (!ok(v.encoding.color)) v.encoding.color = null;
  if (v.encoding.size && table.fieldByName[v.encoding.size]?.type !== 'quantitative') v.encoding.size = null;
  v.filters = v.filters.filter((f) => {
    if (f.kind === 'rows') return f.rows.every((r) => r < table.rowCount);
    const meta = table.fieldByName[f.field];
    if (!meta) return false;
    return f.kind === 'range'
      ? isNumericType(meta.type)
      : meta.type === 'categorical' || meta.type === 'text';
  });
  v.annotations = v.annotations.filter((a) =>
    a.anchor.kind === 'point'
      ? a.anchor.row < table.rowCount
      : a.anchor.kind === 'group'
        ? !!table.fieldByName[a.anchor.field]
        : a.anchor.kind === 'rows'
          ? a.anchor.rows.every((r) => r < table.rowCount)
          : true,
  );
  return v;
}

// ---------------------------------------------------------------------------
// Dataset

export function loadDataset(
  dataset: Dataset,
  opts: { overrides?: Record<string, FieldType>; slides?: Slide[]; name?: string } = {},
) {
  const overrides = opts.overrides ?? {};
  const table = buildTable(dataset, overrides);
  const slides = opts.slides ?? [];
  const first = slides[0];
  set({
    dataset,
    table,
    fieldOverrides: overrides,
    slides,
    activeSlideId: first?.id ?? null,
    view: first ? sanitizeView(first.view, table) : initialView(table),
    deckName: opts.name ?? dataset.name,
    mode: 'edit',
    editingAnnotationId: null,
    selection: [],
    error: null,
  });
}

export function closeDataset() {
  set({
    dataset: null,
    table: null,
    slides: [],
    activeSlideId: null,
    view: defaultView(),
    fieldOverrides: {},
    deckName: initial.deckName,
  });
}

export function setFieldType(name: string, type: FieldType | null) {
  const { dataset, fieldOverrides, view } = get();
  if (!dataset) return;
  const overrides = { ...fieldOverrides };
  if (type === null) delete overrides[name];
  else overrides[name] = type;
  const table = buildTable(dataset, overrides);
  set({ fieldOverrides: overrides, table, view: sanitizeView(view, table) });
}

// ---------------------------------------------------------------------------
// View editing

function updateView(fn: (v: ViewState) => ViewState) {
  set({ view: fn(get().view) });
}

/** Changing inputs of a t-SNE layout invalidates its stored embedding. */
function withoutCoords(layout: LayoutSpec): LayoutSpec {
  return layout.mode === 'tsne' && layout.coords ? { ...layout, coords: undefined } : layout;
}

export function setLayoutMode(mode: LayoutMode) {
  const { table, view } = get();
  if (!table || view.layout.mode === mode) return;
  updateView((v) => ({ ...v, layout: layoutForMode(mode, table, v.layout) }));
}

export function setLayout(layout: LayoutSpec) {
  updateView((v) => ({ ...v, layout }));
}

export type DropZone = 'x' | 'y' | 'color' | 'alone';

/** A field dropped on the stage: onto an axis (switching to 2D if needed), colour, or on its own. */
export function dropField(field: string, zone: DropZone) {
  const { table, view } = get();
  const meta = table?.fieldByName[field];
  if (!table || !meta || meta.type === 'text') return;
  if (zone === 'color') return setEncoding({ color: field });
  if (zone === 'alone') return setLayout({ mode: '1d', field });
  const l = view.layout;
  if (l.mode === '2d') {
    setLayout(zone === 'x' ? { ...l, x: field, logX: false } : { ...l, y: field, logY: false });
    return;
  }
  // Switching to 2D: keep the current 1D field on the other axis when there is one.
  const fallback = layoutForMode('2d', table, { mode: 'cluster' }) as Extract<LayoutSpec, { mode: '2d' }>;
  const pick = (...candidates: (string | undefined)[]) =>
    candidates.find((c) => c && c !== field) ??
    dimensionFields(table).find((f) => f.name !== field)?.name ??
    field;
  const other = pick(
    l.mode === '1d' ? l.field : undefined,
    zone === 'x' ? fallback.y : fallback.x,
    fallback.x,
  );
  setLayout(zone === 'x' ? { mode: '2d', x: field, y: other } : { mode: '2d', x: other, y: field });
}

export function setOverlap(overlap: boolean) {
  updateView((v) => ({ ...v, overlap }));
}

export function setEncoding(patch: Partial<Encoding>) {
  updateView((v) => ({ ...v, encoding: { ...v.encoding, ...patch } }));
}

export function upsertFilter(filter: Filter) {
  updateView((v) => {
    const i = v.filters.findIndex((f) => f.id === filter.id);
    const filters = i >= 0 ? v.filters.map((f, j) => (j === i ? filter : f)) : [...v.filters, filter];
    return { ...v, filters, layout: withoutCoords(v.layout) };
  });
}

export function removeFilter(id: string) {
  updateView((v) => ({
    ...v,
    filters: v.filters.filter((f) => f.id !== id),
    layout: withoutCoords(v.layout),
  }));
}

export function clearFilters() {
  updateView((v) => ({ ...v, filters: [], layout: withoutCoords(v.layout) }));
}

export function setTsneCoords(coords: (number | null)[]) {
  // The embedding arriving is not a user edit: keep it out of undo history.
  withoutHistory(() =>
    updateView((v) => (v.layout.mode === 'tsne' ? { ...v, layout: { ...v.layout, coords } } : v)),
  );
}

export function setCamera(camera: ViewState['camera']) {
  updateView((v) => ({ ...v, camera }));
}

export function setViewText(patch: Partial<Pick<ViewState, 'title' | 'caption'>>) {
  updateView((v) => ({ ...v, ...patch }));
}

/**
 * Adds a note. `subjectRadius` (screen px) is the size of the circle drawn around
 * the anchor; the default offset places the note just outside it.
 */
export function addAnnotation(
  anchor: Annotation['anchor'],
  title: string,
  text = '',
  subjectRadius = 0,
  extra: Partial<Annotation> = {},
): string {
  const id = makeId();
  const { view } = get();
  // Alternate default directions so consecutive notes don't stack.
  const k = view.annotations.length;
  const reach = subjectRadius * Math.SQRT1_2;
  const dx = (k % 2 === 0 ? 1 : -1) * (60 + reach);
  const dy = (k % 4 < 2 ? -1 : 1) * (50 + reach);
  updateView((v) => ({
    ...v,
    annotations: [...v.annotations, { id, anchor, dx, dy, title, text, ...extra }],
  }));
  set({ editingAnnotationId: id });
  return id;
}

export function updateAnnotation(id: string, patch: Partial<Annotation>) {
  updateView((v) => ({
    ...v,
    annotations: v.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  }));
}

export function removeAnnotation(id: string) {
  updateView((v) => ({ ...v, annotations: v.annotations.filter((a) => a.id !== id) }));
  if (get().editingAnnotationId === id) set({ editingAnnotationId: null });
}

// ---------------------------------------------------------------------------
// Lasso selection

export function setSelection(rows: number[], additive = false) {
  const next = additive ? [...new Set([...get().selection, ...rows])] : rows;
  set({ selection: next.sort((a, b) => a - b) });
}

export function clearSelection() {
  if (get().selection.length) set({ selection: [] });
}

/** Drill in: keep only the selected rows. */
export function keepSelection() {
  const rows = get().selection;
  if (!rows.length) return;
  upsertFilter({ id: makeId(), kind: 'rows', mode: 'include', rows });
  set({ selection: [] });
}

/** Hide the selected rows. */
export function excludeSelection() {
  const rows = get().selection;
  if (!rows.length) return;
  upsertFilter({ id: makeId(), kind: 'rows', mode: 'exclude', rows });
  set({ selection: [] });
}

export function annotateSelection(subjectRadius = 0) {
  const rows = get().selection;
  if (!rows.length) return;
  addAnnotation({ kind: 'rows', rows }, `${rows.length.toLocaleString()} selected`, '', subjectRadius);
  set({ selection: [], tool: 'select' });
}

// ---------------------------------------------------------------------------
// Slides

export function addSlide(
  view: ViewState,
  thumbnail: string | null,
  thumbnailTheme?: 'light' | 'dark',
): Slide {
  const { slides, activeSlideId } = get();
  const slide: Slide = { id: makeId(), view: clone(view), thumbnail, thumbnailTheme };
  const at = activeSlideId ? slides.findIndex((s) => s.id === activeSlideId) + 1 : slides.length;
  const next = [...slides];
  next.splice(at, 0, slide);
  set({ slides: next, activeSlideId: slide.id });
  return slide;
}

export function updateSlide(
  id: string,
  view: ViewState,
  thumbnail: string | null,
  thumbnailTheme?: 'light' | 'dark',
) {
  set({
    slides: get().slides.map((s) =>
      s.id === id
        ? {
            ...s,
            view: clone(view),
            thumbnail: thumbnail ?? s.thumbnail,
            thumbnailTheme: thumbnail ? thumbnailTheme : s.thumbnailTheme,
          }
        : s,
    ),
  });
}

/** Replaces a slide's preview image (not an undoable edit). */
export function setSlideThumbnail(id: string, thumbnail: string, thumbnailTheme: 'light' | 'dark') {
  withoutHistory(() =>
    set({ slides: get().slides.map((s) => (s.id === id ? { ...s, thumbnail, thumbnailTheme } : s)) }),
  );
}

export function selectSlide(id: string) {
  const { slides, table } = get();
  const slide = slides.find((s) => s.id === id);
  if (!slide || !table) return;
  set({ activeSlideId: id, view: sanitizeView(slide.view, table), editingAnnotationId: null });
}

export function deleteSlide(id: string) {
  const { slides, activeSlideId } = get();
  const i = slides.findIndex((s) => s.id === id);
  const next = slides.filter((s) => s.id !== id);
  set({
    slides: next,
    activeSlideId: activeSlideId === id ? (next[Math.min(i, next.length - 1)]?.id ?? null) : activeSlideId,
  });
}

export function duplicateSlide(id: string) {
  const { slides } = get();
  const i = slides.findIndex((s) => s.id === id);
  if (i < 0) return;
  const copy: Slide = { ...clone(slides[i]), id: makeId() };
  const next = [...slides];
  next.splice(i + 1, 0, copy);
  set({ slides: next, activeSlideId: copy.id, view: clone(copy.view) });
}

export function moveSlide(from: number, to: number) {
  const next = [...get().slides];
  const [s] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, s);
  set({ slides: next });
}

export function isViewDirty(state: Pick<AppState, 'slides' | 'activeSlideId' | 'view'>): boolean {
  const slide = state.slides.find((s) => s.id === state.activeSlideId);
  if (!slide) return false;
  return JSON.stringify(stripCoords(slide.view)) !== JSON.stringify(stripCoords(state.view));
}

function stripCoords(v: ViewState) {
  return v.layout.mode === 'tsne' ? { ...v, layout: { ...v.layout, coords: undefined } } : v;
}

// ---------------------------------------------------------------------------
// Presentation

/** Editor state saved when presenting starts, so unsaved edits survive a quick preview. */
let beforePresenting: { view: ViewState; activeSlideId: string | null; index: number } | null = null;

export function startPresentation(index?: number) {
  const { slides, activeSlideId, table, view } = get();
  if (!slides.length || !table) return;
  const i =
    index ??
    Math.max(
      0,
      slides.findIndex((s) => s.id === activeSlideId),
    );
  beforePresenting = { view, activeSlideId, index: i };
  set({
    mode: 'present',
    presentIndex: i,
    view: sanitizeView(slides[i].view, table),
    editingAnnotationId: null,
    selection: [],
    tool: 'select',
  });
}

export function gotoSlide(i: number) {
  const { slides, table } = get();
  if (!table || i < 0 || i >= slides.length) return;
  set({ presentIndex: i, view: sanitizeView(slides[i].view, table) });
}

/** Leaves presentation on the last shown slide (or back to the untouched editor state). */
export function exitPresentation() {
  const { slides, presentIndex, table } = get();
  const slide = slides[presentIndex];
  const saved = beforePresenting;
  beforePresenting = null;
  if (saved && saved.index === presentIndex && saved.activeSlideId === (slide?.id ?? null)) {
    set({ mode: 'edit', activeSlideId: saved.activeSlideId, view: saved.view });
    return;
  }
  set({
    mode: 'edit',
    activeSlideId: slide?.id ?? null,
    view: slide && table ? sanitizeView(slide.view, table) : get().view,
  });
}

// ---------------------------------------------------------------------------
// Deck (persistence)

export function toDeck(): Deck {
  const s = get();
  return {
    format: 'datadeck',
    version: 1,
    name: s.deckName,
    dataset: s.dataset,
    fieldOverrides: s.fieldOverrides,
    slides: s.slides,
  };
}

export function loadDeck(deck: Deck) {
  if (!deck.dataset) {
    closeDataset();
    set({ deckName: deck.name });
    return;
  }
  loadDataset(deck.dataset, { overrides: deck.fieldOverrides, slides: deck.slides, name: deck.name });
}

export const actions = { set, get };
