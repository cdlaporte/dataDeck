import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { getEngine } from './engine/instance';
import {
  exitPresentation,
  gotoSlide,
  isViewDirty,
  setCamera,
  setLayoutMode,
  startPresentation,
  useStore,
} from './state/store';
import { DEFAULT_CAMERA, type LayoutMode } from './state/types';
import { snapshot, updateActiveSlide } from './ui/actions';
import { redo, undo } from './state/history';
import { DataPanel } from './ui/DataPanel';
import { IconX } from './ui/icons';
import { SlideStrip } from './ui/SlideStrip';
import { Stage } from './ui/Stage';
import { TopBar } from './ui/TopBar';
import { ViewPanel } from './ui/ViewPanel';
import { Welcome } from './ui/Welcome';

const MODE_KEYS: Record<string, LayoutMode> = { '1': 'cluster', '2': '1d', '3': '2d', '4': 'tsne' };

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']);

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const s = useStore.getState();
        if (!s.table || s.mode !== 'edit') return;
        const k = e.key.toLowerCase();
        if (k === 'f') {
          e.preventDefault();
          useStore.setState({ findOpen: true });
        } else if (!isTyping(e) && (k === 'z' || k === 'y')) {
          // Text fields keep their own native undo.
          e.preventDefault();
          if (k === 'y' || e.shiftKey) redo();
          else undo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const s = useStore.getState();
      if (!s.table) return;
      if (s.mode === 'present') {
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key))
          gotoSlide(s.presentIndex + 1);
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key))
          gotoSlide(s.presentIndex - 1);
        else if (e.key === 'Home') gotoSlide(0);
        else if (e.key === 'End') gotoSlide(s.slides.length - 1);
        else if (e.key === 'Escape') exitPresentation();
        else return;
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 's') void snapshot();
      else if (key === 'u' && isViewDirty(s)) void updateActiveSlide();
      else if (key === 'p' && s.slides.length) startPresentation();
      else if (key === 'a') useStore.setState({ tool: s.tool === 'annotate' ? 'select' : 'annotate' });
      else if (key === 'v') useStore.setState({ tool: 'select' });
      else if (key === 'l') useStore.setState({ tool: s.tool === 'lasso' ? 'select' : 'lasso' });
      else if (key === 't') useStore.setState({ tool: s.tool === 'text' ? 'select' : 'text' });
      else if (key === '0') setCamera({ ...DEFAULT_CAMERA });
      else if (MODE_KEYS[key]) setLayoutMode(MODE_KEYS[key]);
      else if (e.key === 'Escape')
        useStore.setState({ tool: 'select', editingAnnotationId: null, selection: [] });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Enter/leave browser fullscreen with presentation mode. */
function useFullscreen() {
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    if (mode === 'present') {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, [mode]);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && useStore.getState().mode === 'present') exitPresentation();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
}

export function App() {
  const hydrated = useStore((s) => s.hydrated);
  const hasData = useStore((s) => !!s.table);
  const mode = useStore((s) => s.mode);
  const [dataDialog, setDataDialog] = useState(false);
  useShortcuts();
  useFullscreen();

  useEffect(() => {
    // Expose a frame-time readout for performance checks in dev tools / e2e.
    (window as unknown as { __datadeck?: unknown }).__datadeck = { engine: getEngine, store: useStore };
  }, []);

  if (!hydrated) return null;
  if (!hasData) {
    return (
      <div className="welcome">
        <Welcome />
      </div>
    );
  }

  return (
    <div className={`app${mode === 'present' ? ' presenting' : ''}`}>
      <TopBar onChangeData={() => setDataDialog(true)} />
      <DataPanel />
      <Stage />
      <ViewPanel />
      <SlideStrip />
      <Dialog.Root open={dataDialog} onOpenChange={setDataDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Change dataset</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn icon ghost dialog-close" aria-label="Close">
                <IconX />
              </button>
            </Dialog.Close>
            <p className="section-hint" style={{ margin: '24px 28px -8px' }}>
              Loading a new dataset starts a new deck. Export this one first if you want to keep it.
            </p>
            <Welcome compact onDone={() => setDataDialog(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
