import { useEffect, useRef, useState } from 'react';
import { rowLabel } from '../data/format';
import { Engine, type HoverInfo } from '../engine/Engine';
import { setEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import {
  addAnnotation,
  setCamera,
  setTsneCoords,
  setViewText,
  updateAnnotation,
  useStore,
} from '../state/store';
import { AnnotationEditor } from './AnnotationEditor';
import { Legend } from './Legend';
import { PresentControls } from './PresentControls';
import { StageToolbar } from './StageToolbar';
import { Tooltip } from './Tooltip';
import { TsneProgress } from './TsneProgress';

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const title = useStore((s) => s.view.title);
  const caption = useStore((s) => s.view.caption);
  const info = useStore((s) => s.layoutInfo);

  useEffect(() => {
    const el = ref.current!;
    const set = useStore.setState;
    const engine = new Engine(el, {
      onHover: setHover,
      onClick: (click) => {
        const s = useStore.getState();
        if (s.mode !== 'edit' || !s.table) return;
        if (s.tool === 'annotate') {
          if (click.row !== null) addAnnotation({ kind: 'point', row: click.row }, rowLabel(s.table, click.row));
          else addAnnotation({ kind: 'free', x: click.nx, y: click.ny }, 'Note');
          set({ tool: 'select' });
        } else if (s.editingAnnotationId) {
          set({ editingAnnotationId: null });
        }
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
        addAnnotation({ kind: 'group', field, value }, value);
        set({ tool: 'select' });
      },
    });
    setEngine(engine);
    engine.setTheme(readThemeColors());
    const s = useStore.getState();
    engine.setTool(s.tool);
    engine.setTable(s.table, s.view);

    const unsubscribe = useStore.subscribe((next, prev) => {
      if (next.table !== prev.table) engine.setTable(next.table, next.view);
      else if (next.view !== prev.view) engine.setView(next.view, { animateCamera: true });
      if (next.tool !== prev.tool) engine.setTool(next.tool);
    });
    return () => {
      unsubscribe();
      engine.dispose();
      setEngine(null);
    };
  }, []);

  const presenting = mode === 'present';
  return (
    <main className="stage-wrap" aria-label="Visualization stage">
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
          />
        )}
      </div>
      <Legend />
      <TsneProgress />
      {tool === 'annotate' && !presenting && (
        <div className="hint">Click a bubble, a group label or empty space to add a note · Esc to cancel</div>
      )}
      {info && (
        <div className="stage-status" aria-live="polite">
          <span>
            Showing <strong>{info.visibleCount.toLocaleString()}</strong> of {info.totalCount.toLocaleString()}
          </span>
          {info.message && <span>{info.message}</span>}
        </div>
      )}
      {presenting ? <PresentControls /> : <StageToolbar />}
      {!presenting && <AnnotationEditor />}
      {hover && <Tooltip hover={hover} />}
    </main>
  );
}
