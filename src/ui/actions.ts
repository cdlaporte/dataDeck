import { getEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import { ParseError, parseDelimited } from '../data/parse';
import { downloadDeck, parseDeck } from '../persist/deckFile';
import {
  addSlide,
  clone,
  loadDataset,
  loadDeck,
  toDeck,
  updateSlide,
  upsertFilter,
  removeFilter,
  useStore,
} from '../state/store';
import type { ViewState } from '../state/types';

/** The current view, with a running t-SNE's embedding frozen into it. */
function captureView(): ViewState {
  const view = clone(useStore.getState().view);
  if (view.layout.mode === 'tsne' && !view.layout.coords) {
    const coords = getEngine()?.currentTsneCoords();
    if (coords) view.layout.coords = coords;
  }
  return view;
}

export async function snapshot() {
  const view = captureView();
  const thumb = (await getEngine()?.captureThumbnail(view.title)) ?? null;
  useStore.setState({ view });
  addSlide(view, thumb, readThemeColors().name);
}

export async function updateActiveSlide() {
  const { activeSlideId } = useStore.getState();
  if (!activeSlideId) return;
  const view = captureView();
  const thumb = (await getEngine()?.captureThumbnail(view.title)) ?? null;
  useStore.setState({ view });
  updateSlide(activeSlideId, view, thumb, readThemeColors().name);
}

/** Toggles a category in the categorical filter for `field` (used by legend clicks). */
export function toggleCategory(field: string, value: string) {
  const { view } = useStore.getState();
  const existing = view.filters.find((f) => f.kind === 'categorical' && f.field === field);
  if (existing && existing.kind === 'categorical') {
    const exclude = existing.exclude.includes(value)
      ? existing.exclude.filter((v) => v !== value)
      : [...existing.exclude, value];
    if (exclude.length === 0) removeFilter(existing.id);
    else upsertFilter({ ...existing, exclude });
  } else {
    upsertFilter({ id: `cat-${field}`, kind: 'categorical', field, exclude: [value] });
  }
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

/** Opens a CSV/TSV (new dataset) or a .datadeck.json (full deck). */
export async function openFile(file: File) {
  try {
    const text = await readFile(file);
    if (/\.json$/i.test(file.name)) {
      loadDeck(parseDeck(text));
      return;
    }
    const name = file.name.replace(/\.(csv|tsv|txt)$/i, '');
    loadDataset(parseDelimited(text, name, 'upload'));
  } catch (err) {
    const message = err instanceof ParseError || err instanceof Error ? err.message : String(err);
    useStore.setState({ error: `Couldn’t open “${file.name}”: ${message}` });
  }
}

export function pickFile(accept: string, onFile: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) onFile(f);
  };
  input.click();
}

export function exportDeck() {
  downloadDeck(toDeck());
}
