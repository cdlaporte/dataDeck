import { beforeEach, describe, expect, it } from 'vitest';
import { parseDelimited } from '../data/parse';
import { clearHistory, initHistory, redo, undo } from './history';
import {
  loadDataset,
  resetCategoryColors,
  setCamera,
  setCategoryColor,
  setLayout,
  setReference,
  setTsneCoords,
  setViewText,
  useStore,
} from './store';

let clock = 0;
initHistory(useStore, () => clock);

const csv = 'name,species,mass\na,x,1.5\nb,y,2.5\nc,x,3.5\nd,y,4.5\ne,z,5.5\n';

describe('undo / redo', () => {
  beforeEach(() => {
    loadDataset(parseDelimited(csv, 'h'));
    clearHistory();
    clock = 0;
  });

  it('undoes and redoes a layout change', () => {
    setLayout({ mode: '1d', field: 'mass' });
    expect(useStore.getState().canUndo).toBe(true);
    undo();
    expect(useStore.getState().view.layout.mode).toBe('cluster');
    expect(useStore.getState().canRedo).toBe(true);
    redo();
    expect(useStore.getState().view.layout).toEqual({ mode: '1d', field: 'mass' });
  });

  it('undoes category colour and reference line changes', () => {
    setCategoryColor('species', 'x', '#ff0000');
    expect(useStore.getState().categoryColors).toEqual({ species: { x: '#ff0000' } });
    clock += 2000;
    setLayout({ mode: '1d', field: 'mass' });
    clock += 2000;
    setReference('median');
    undo();
    expect(useStore.getState().view.reference).toBeUndefined();
    undo();
    undo();
    expect(useStore.getState().categoryColors).toEqual({});
    redo();
    expect(useStore.getState().categoryColors.species.x).toBe('#ff0000');
    resetCategoryColors('species');
    expect(useStore.getState().categoryColors).toEqual({});
  });

  it('coalesces a burst of edits into one step', () => {
    for (const title of ['H', 'He', 'Hel', 'Hello']) {
      clock += 100;
      setViewText({ title });
    }
    clock += 2000;
    setLayout({ mode: '1d', field: 'species' });
    undo();
    expect(useStore.getState().view.title).toBe('Hello');
    undo();
    expect(useStore.getState().view.title).toBe('');
    expect(useStore.getState().canUndo).toBe(false);
  });

  it('ignores camera moves and t-SNE embeddings', () => {
    setCamera({ cx: 0.3, cy: 0.5, k: 2 });
    expect(useStore.getState().canUndo).toBe(false);
    setLayout({
      mode: 'tsne',
      fields: ['mass', 'species'],
      params: { perplexity: 5, epsilon: 10, iterations: 10 },
    });
    clock += 2000;
    setTsneCoords([0.1, 0.2]);
    undo();
    expect(useStore.getState().view.layout.mode).toBe('cluster');
  });

  it('drops the redo stack on a new edit', () => {
    setLayout({ mode: '1d', field: 'mass' });
    undo();
    clock += 2000;
    setViewText({ caption: 'new' });
    expect(useStore.getState().canRedo).toBe(false);
  });
});
