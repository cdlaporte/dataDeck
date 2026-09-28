import { beforeEach, describe, expect, it } from 'vitest';
import { parseDelimited } from '../data/parse';
import { addAnnotation, addSlide, loadDataset, setNotePlacer, updateSlide, useStore } from './store';

const csv = 'name,species,mass\na,x,1.5\nb,y,2.5\nc,x,3.5\nd,y,4.5\ne,z,5.5\n';

describe('slide frames and note placement', () => {
  beforeEach(() => {
    loadDataset(parseDelimited(csv, 'f'));
    setNotePlacer(null);
  });

  it('records the frame a slide was composed at', () => {
    const slide = addSlide(useStore.getState().view, null, 'light', { width: 900, height: 600 });
    expect(useStore.getState().slides[0].frame).toEqual({ width: 900, height: 600 });
    updateSlide(slide.id, useStore.getState().view, null, 'light', { width: 1000, height: 700 });
    expect(useStore.getState().slides[0].frame).toEqual({ width: 1000, height: 700 });
    updateSlide(slide.id, useStore.getState().view, null);
    expect(useStore.getState().slides[0].frame).toEqual({ width: 1000, height: 700 });
  });

  it('stores the side the placer picks for callouts, but not for text boxes', () => {
    setNotePlacer((_anchor, dx, dy) => [-dx, -dy]);
    const id = addAnnotation({ kind: 'point', row: 0 }, 'a');
    const note = useStore.getState().view.annotations.find((a) => a.id === id)!;
    expect(note.dx).toBeLessThan(0);
    expect(note.dy).toBeGreaterThan(0);
    const text = addAnnotation({ kind: 'free', x: 0.5, y: 0.5 }, 't', '', 0, { style: 'text', dx: 0, dy: 0 });
    expect(useStore.getState().view.annotations.find((a) => a.id === text)).toMatchObject({ dx: 0, dy: 0 });
  });
});
