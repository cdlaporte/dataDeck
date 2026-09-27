import { DEFAULT_CAMERA } from '../state/types';
import { isViewDirty, setCamera, startPresentation, useStore } from '../state/store';
import { snapshot, updateActiveSlide } from './actions';
import {
  IconCamera,
  IconCursor,
  IconLasso,
  IconMaximize,
  IconNote,
  IconPlay,
  IconSave,
  IconSearch,
  IconText,
} from './icons';
import type { Tool } from '../engine/Engine';

export function StageToolbar() {
  const tool = useStore((s) => s.tool);
  const hasSlides = useStore((s) => s.slides.length > 0);
  const dirty = useStore(isViewDirty);
  const camera = useStore((s) => s.view.camera);
  const zoomed =
    Math.abs(camera.k - 1) > 1e-3 || Math.abs(camera.cx - 0.5) > 1e-3 || Math.abs(camera.cy - 0.5) > 1e-3;
  const setTool = (t: Tool) => useStore.setState({ tool: t });

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
        aria-pressed={tool === 'text'}
        title="Text box (T)"
        aria-label="Text box"
        onClick={() => setTool(tool === 'text' ? 'select' : 'text')}
      >
        <IconText />
      </button>
      <button
        type="button"
        className="btn icon ghost"
        aria-pressed={tool === 'lasso'}
        title="Lasso select (L) — or Shift-drag anytime"
        aria-label="Lasso select"
        onClick={() => setTool(tool === 'lasso' ? 'select' : 'lasso')}
      >
        <IconLasso />
      </button>
      <button
        type="button"
        className="btn icon ghost"
        title="Find a data point (⌘/Ctrl+F)"
        aria-label="Find a data point"
        onClick={() => useStore.setState({ findOpen: true })}
      >
        <IconSearch />
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
        <button
          type="button"
          className="btn ghost"
          title="Save changes to the selected slide (U)"
          onClick={() => void updateActiveSlide()}
        >
          <IconSave /> Update slide
        </button>
      )}
      <button
        type="button"
        className="btn primary"
        title="Snapshot this view as a new slide (S)"
        onClick={() => void snapshot()}
      >
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
