import { DEFAULT_CAMERA } from '../state/types';
import { isViewDirty, setCamera, startPresentation, useStore } from '../state/store';
import { snapshot, updateActiveSlide } from './actions';
import { IconCamera, IconCursor, IconMaximize, IconNote, IconPlay, IconSave } from './icons';

export function StageToolbar() {
  const tool = useStore((s) => s.tool);
  const hasSlides = useStore((s) => s.slides.length > 0);
  const dirty = useStore(isViewDirty);
  const camera = useStore((s) => s.view.camera);
  const zoomed = Math.abs(camera.k - 1) > 1e-3 || Math.abs(camera.cx - 0.5) > 1e-3 || Math.abs(camera.cy - 0.5) > 1e-3;
  const setTool = (t: 'select' | 'annotate') => useStore.setState({ tool: t });

  return (
    <div className="stage-toolbar" role="toolbar" aria-label="Stage tools">
      <button
        type="button"
        className="btn icon ghost"
        aria-pressed={tool === 'select'}
        title="Select & pan (V)"
        aria-label="Select and pan"
        onClick={() => setTool('select')}
      >
        <IconCursor />
      </button>
      <button
        type="button"
        className="btn icon ghost"
        aria-pressed={tool === 'annotate'}
        title="Annotate (A)"
        aria-label="Annotate"
        onClick={() => setTool(tool === 'annotate' ? 'select' : 'annotate')}
      >
        <IconNote />
      </button>
      <button
        type="button"
        className="btn icon ghost"
        title="Reset zoom (0)"
        aria-label="Reset zoom"
        disabled={!zoomed}
        onClick={() => setCamera({ ...DEFAULT_CAMERA })}
      >
        <IconMaximize />
      </button>
      <span className="sep" />
      {dirty && (
        <button type="button" className="btn ghost" title="Save changes to the selected slide (U)" onClick={() => void updateActiveSlide()}>
          <IconSave /> Update slide
        </button>
      )}
      <button type="button" className="btn primary" title="Snapshot this view as a new slide (S)" onClick={() => void snapshot()}>
        <IconCamera /> Snapshot
      </button>
      <button
        type="button"
        className="btn ghost"
        title="Present (P)"
        disabled={!hasSlides}
        onClick={() => startPresentation()}
      >
        <IconPlay /> Present
      </button>
    </div>
  );
}
