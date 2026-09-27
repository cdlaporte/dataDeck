// Core data model. Everything in ViewState / Slide / Deck is plain JSON so it
// can be snapshotted, persisted to IndexedDB and exported as a .datadeck file.

export type FieldType = 'quantitative' | 'categorical' | 'date' | 'text';

export type DateUnit = 'year' | 'day' | 'time';

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface CategoryCount {
  value: string;
  count: number;
}

export interface FieldMeta {
  name: string;
  /** Type guessed by the profiler. */
  inferredType: FieldType;
  /** Effective type (inferred unless the user overrode it). */
  type: FieldType;
  missing: number;
  distinct: number;
  /** Quantitative & date (dates are epoch ms). */
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  isInteger?: boolean;
  /** Dates: finest unit present, for formatting. */
  dateUnit?: DateUnit;
  histogram?: HistogramBin[];
  /** Categorical & text: sorted by count, descending. */
  categories?: CategoryCount[];
}

export interface Dataset {
  id: string;
  name: string;
  source: 'sample' | 'upload';
  columns: string[];
  rows: Record<string, string>[];
}

export type Column =
  | { kind: 'number'; values: Float64Array } // NaN = missing
  | { kind: 'string'; values: (string | null)[] };

/** Typed, profiled view of a dataset. Row index doubles as the stable row id. */
export interface DataTable {
  datasetId: string;
  rowCount: number;
  fields: FieldMeta[];
  fieldByName: Record<string, FieldMeta>;
  columns: Record<string, Column>;
  /** Field used to name rows in tooltips / annotations. */
  labelField: string | null;
}

export interface TsneParams {
  perplexity: number;
  epsilon: number;
  iterations: number;
}

export type LayoutSpec =
  | { mode: 'cluster' }
  | { mode: '1d'; field: string }
  | { mode: '2d'; x: string; y: string }
  | {
      mode: 'tsne';
      fields: string[];
      params: TsneParams;
      /** Normalised [0,1] xy pairs (length 2n, null for rows not embedded). */
      coords?: (number | null)[];
    };

export type LayoutMode = LayoutSpec['mode'];

export interface Encoding {
  color: string | null;
  size: string | null;
}

export type Filter =
  | { id: string; kind: 'categorical'; field: string; exclude: string[] }
  | { id: string; kind: 'range'; field: string; min: number; max: number };

export type AnnotationAnchor =
  | { kind: 'point'; row: number }
  | { kind: 'group'; field: string; value: string }
  /** Free anchors are stored in normalised viewport coords so they survive resizes. */
  | { kind: 'free'; x: number; y: number };

export interface Annotation {
  id: string;
  anchor: AnnotationAnchor;
  /** Label offset from the anchor, in screen px. */
  dx: number;
  dy: number;
  title: string;
  text: string;
}

/** Zoom state, stored relative to the viewport: (cx, cy) is the normalised
 *  world point shown at the screen centre, k the zoom factor. */
export interface CameraState {
  cx: number;
  cy: number;
  k: number;
}

export interface ViewState {
  layout: LayoutSpec;
  encoding: Encoding;
  filters: Filter[];
  annotations: Annotation[];
  camera: CameraState;
  title: string;
  caption: string;
}

export interface Slide {
  id: string;
  view: ViewState;
  thumbnail: string | null;
}

export interface Deck {
  format: 'datadeck';
  version: 1;
  name: string;
  dataset: Dataset | null;
  fieldOverrides: Record<string, FieldType>;
  slides: Slide[];
}

export const DEFAULT_CAMERA: CameraState = { cx: 0.5, cy: 0.5, k: 1 };

export const DEFAULT_TSNE: TsneParams = { perplexity: 30, epsilon: 100, iterations: 1000 };

export function defaultView(): ViewState {
  return {
    layout: { mode: 'cluster' },
    encoding: { color: null, size: null },
    filters: [],
    annotations: [],
    camera: { ...DEFAULT_CAMERA },
    title: '',
    caption: '',
  };
}
