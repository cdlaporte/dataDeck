import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rowLabel } from '../data/format';
import { Engine, type HoverInfo } from '../engine/Engine';
import type { Frame } from '../state/types';
import { fitFrame } from './frame';
import { getEngine as getEngineSafe, setEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import {
  addAnnotation,
  clearSelection,
  setSelection,
  setCamera,
  setNotePlacer,
  setTsneCoords,
  setViewText,
  updateAnnotation,
  useStore,
} from '../state/store';
import { AnnotationEditor } from './AnnotationEditor';
import { DropZones } from './DropZones';
import { FindBox } from './FindBox';
import { SelectionBar } from './SelectionBar';
import { Legend } from './Legend';
import { PresentControls } from './PresentControls';
import { StageToolbar } from './StageToolbar';
import { Tooltip } from './Tooltip';
import { TsneProgress } from './TsneProgress';

function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
}

/** Content-box size of an element, kept current with a ResizeObserver. */
function useElementSize(ref: React.RefObject<HTMLElement | null>): Frame | null {
  const [size, setSize] = useState<Frame | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const wrapSize = useElementSize(wrapRef);
  // Presenting (or exporting) shows a slide at the size it was composed at, scaled to fit.
  const frame = useStore((s) =>
    s.mode === 'present' ? (s.slides[s.presentIndex]?.frame ?? null) : s.renderFrame,
  );
  const fit = frame && wrapSize ? fitFrame(frame, wrapSize) : null;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const title = useStore((s) => s.view.title);
  const caption = useStore((s) => s.view.caption);
  const info = useStore((s) => s.layoutInfo);
  const hasSelection = useStore((s) => s.selection.length > 0);
  const exporting = useStore((s) => s.exporting);

  useEffect(() => {
    const el = ref.current!;
    const set = useStore.setState;
    const engine = new Engine(el, {
      onHover: setHover,
      onClick: (click) => {
        const s = useStore.getState();
        if (s.mode !== 'edit' || !s.table) return;
        if (s.tool === 'text') {
          addAnnotation({ kind: 'free', x: click.nx, y: click.ny }, 'Text', '', 0, {
            style: 'text',
            dx: 0,
            dy: 0,
          });
          set({ tool: 'select' });
        } else if (s.tool === 'annotate') {
          if (click.row !== null)
            addAnnotation({ kind: 'point', row: click.row }, rowLabel(s.table, click.row));
          else addAnnotation({ kind: 'free', x: click.nx, y: click.ny }, 'Note');
          set({ tool: 'select' });
        } else if (s.editingAnnotationId) {
          set({ editingAnnotationId: null });
        } else if (click.row === null) {
          clearSelection();
        }
      },
      onSelect: (rows, additive) => {
        if (useStore.getState().mode === 'edit') setSelection(rows, additive);
      },
      onCameraChange: (camera) => setCamera(camera),
      onLayoutInfo: (layoutInfo) => set({ layoutInfo }),
      onTsneStatus: (tsneStatus) => set({ tsneStatus }),
      onTsneDone: (coords) => setTsneCoords(coords),
      onAnnotationMove: (id, dx, dy) => updateAnnotation(id, { dx, dy }),
      onAnnotationEdit: (id) => {
        if (useStore.getState().mode === 'edit') set({ editingAnnotationId: id });
      },
      onGroupClick: (field, value) => {
        const anchor = { kind: 'group' as const, field, value };
        addAnnotation(anchor, value, '', engine.subjectRadius(anchor));
        set({ tool: 'select' });
      },
    });
    setEngine(engine);
    setNotePlacer((anchor, dx, dy) => engine.fitNoteOffset(anchor, dx, dy));
    engine.setTheme(readThemeColors());
    const s = useStore.getState();
    engine.setTool(s.tool);
    engine.setMotion(s.motion);
    engine.setCategoryColors(s.categoryColors);
    engine.setTable(s.table, s.view);
    engine.setSelection(s.selection);

    const unsubscribe = useStore.subscribe((next, prev) => {
      // Colours first, so a freshly loaded deck lays out with its own palette.
      if (next.categoryColors !== prev.categoryColors) engine.setCategoryColors(next.categoryColors);
      if (next.table !== prev.table) engine.setTable(next.table, next.view);
      else if (next.view !== prev.view) engine.setView(next.view, { animateCamera: true });
      if (next.tool !== prev.tool) engine.setTool(next.tool);
      if (next.motion !== prev.motion) engine.setMotion(next.motion);
      if (next.selection !== prev.selection || next.table !== prev.table) engine.setSelection(next.selection);
    });
    return () => {
      unsubscribe();
      setNotePlacer(null);
      engine.dispose();
      setEngine(null);
    };
  }, []);

  const scale = fit?.scale ?? 1;
  useLayoutEffect(() => {
    getEngineSafe()?.setDisplayScale(scale);
  }, [scale]);

  const presenting = mode === 'present';
  const frameStyle: React.CSSProperties | undefined =
    frame && fit
      ? {
          width: frame.width,
          height: frame.height,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
        }
      : undefined;
  return (
    <main className="stage-wrap" aria-label="Visualization stage" ref={wrapRef}>
      <div className={`slide-frame${frameStyle ? ' framed' : ''}`} style={frameStyle}>
        <div ref={ref} className="stage" data-testid="stage" />
        <div className="stage-title">
          <input
            className="title-input"
            value={title}
            placeholder="Add a title"
            aria-label="Slide title"
            readOnly={presenting}
            tabIndex={presenting ? -1 : 0}
            onChange={(e) => setViewText({ title: e.target.value })}
            onKeyDown={blurOnEnter}
          />
          {(caption || !presenting) && (
            <input
              className="caption-input"
              value={caption}
              placeholder="Add a caption"
              aria-label="Slide caption"
              readOnly={presenting}
              tabIndex={presenting ? -1 : 0}
              onChange={(e) => setViewText({ caption: e.target.value })}
              onKeyDown={blurOnEnter}
            />
          )}
        </div>
        <Legend />
        <TsneProgress />
        {info && (
          <div className="stage-status" aria-live="polite">
            <span>
              Showing <strong>{info.visibleCount.toLocaleString()}</strong> of{' '}
              {info.totalCount.toLocaleString()}
            </span>
            {info.message && <span>{info.message}</span>}
          </div>
        )}
      </div>
      {tool === 'annotate' && !presenting && (
        <div className="hint">Click a bubble, a group label or empty space to add a note · Esc to cancel</div>
      )}
      {tool === 'text' && !presenting && (
        <div className="hint">Click anywhere to place a text box · Esc to cancel</div>
      )}
      {tool === 'lasso' && !presenting && !hasSelection && (
        <div className="hint">Drag to draw around bubbles · Shift adds · Esc to finish</div>
      )}
      {!presenting && <SelectionBar />}
      {!presenting && <DropZones />}
      {!presenting && <FindBox />}
      {exporting && (
        <div className="export-overlay" role="status">
          <div>{exporting}</div>
        </div>
      )}
      {presenting ? <PresentControls /> : <StageToolbar />}
      {!presenting && <AnnotationEditor />}
      {hover && <Tooltip hover={hover} />}
    </main>
  );
}
