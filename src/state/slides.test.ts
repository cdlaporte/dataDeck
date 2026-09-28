import { beforeEach, describe, expect, it } from 'vitest';
import { parseDelimited } from '../data/parse';
import { addAnnotation, addSlide, loadDataset, setNoteContext, updateSlide, useStore } from './store';

const csv = 'name,species,mass\na,x,1.5\nb,y,2.5\nc,x,3.5\nd,y,4.5\ne,z,5.5\n';

describe('slide frames and note placement', () => {
  beforeEach(() => {
    loadDataset(parseDelimited(csv, 'f'));
    setNoteContext(null);
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
    setNoteContext({ place: (_anchor, dx, dy) => [-dx, -dy], frame: () => ({ width: 800, height: 600 }) });
    const id = addAnnotation({ kind: 'point', row: 0 }, 'a');
    const note = useStore.getState().view.annotations.find((a) => a.id === id)!;
    expect(note.dx).toBeLessThan(0);
    expect(note.dy).toBeGreaterThan(0);
    const text = addAnnotation({ kind: 'free', x: 0.5, y: 0.5 }, 't', '', 0, { style: 'text', dx: 0, dy: 0 });
    expect(useStore.getState().view.annotations.find((a) => a.id === text)).toMatchObject({ dx: 0, dy: 0 });
  });
});

describe('note frames', () => {
  it('stamps new notes with the stage frame', () => {
    loadDataset(parseDelimited(csv, 'g'));
    setNoteContext({ place: (_a, dx, dy) => [dx, dy], frame: () => ({ width: 900, height: 640 }) });
    const id = addAnnotation({ kind: 'free', x: 0.5, y: 0.5 }, 'n');
    expect(useStore.getState().view.annotations.find((a) => a.id === id)?.frame).toEqual({
      width: 900,
      height: 640,
    });
    setNoteContext(null);
  });

  it('backfills older notes from their slide frame when a deck loads', () => {
    const view = {
      ...useStore.getState().view,
      annotations: [
        {
          id: 'n1',
          anchor: { kind: 'free' as const, x: 0.2, y: 0.2 },
          dx: 10,
          dy: 10,
          title: 'old',
          text: '',
        },
      ],
    };
    loadDataset(parseDelimited(csv, 'h'), {
      slides: [{ id: 's1', view, thumbnail: null, frame: { width: 800, height: 500 } }],
    });
    const s = useStore.getState();
    expect(s.slides[0].view.annotations[0].frame).toEqual({ width: 800, height: 500 });
    expect(s.view.annotations[0].frame).toEqual({ width: 800, height: 500 });
  });
});
