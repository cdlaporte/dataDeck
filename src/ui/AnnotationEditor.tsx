import { useEffect, useRef } from 'react';
import { getEngine } from '../engine/instance';
import { removeAnnotation, updateAnnotation, useStore } from '../state/store';
import { IconTrash } from './icons';

export function AnnotationEditor() {
  const id = useStore((s) => s.editingAnnotationId);
  const annotation = useStore((s) => s.view.annotations.find((a) => a.id === s.editingAnnotationId));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) requestAnimationFrame(() => titleRef.current?.select());
  }, [id]);

  if (!id || !annotation) return null;
  const close = () => useStore.setState({ editingAnnotationId: null });
  const pos = getEngine()?.annotationScreenPosition(id) ?? { x: 200, y: 200 };
  const stage = getEngine()?.container.getBoundingClientRect();
  const W = 260;
  let left = annotation.dx >= 0 ? pos.x + 16 : pos.x - W - 16;
  let top = pos.y - 20;
  if (stage) {
    left = Math.max(12, Math.min(stage.width - W - 12, left));
    top = Math.max(12, Math.min(stage.height - 220, top));
  }

  return (
    <div
      className="annotation-editor"
      style={{ left, top }}
      role="dialog"
      aria-label="Edit annotation"
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <input
        ref={titleRef}
        className="text-input"
        value={annotation.title}
        placeholder="Title"
        aria-label="Annotation title"
        onChange={(e) => updateAnnotation(id, { title: e.target.value })}
      />
      <textarea
        className="textarea"
        value={annotation.text}
        placeholder="Add a note…"
        aria-label="Annotation text"
        onChange={(e) => updateAnnotation(id, { text: e.target.value })}
      />
      <div className="row">
        <button type="button" className="btn ghost small danger" onClick={() => removeAnnotation(id)}>
          <IconTrash size={14} /> Delete
        </button>
        <button type="button" className="btn primary small" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
