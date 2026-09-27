import { useEffect, useRef } from 'react';
import { getEngine } from '../engine/instance';
import { CATEGORICAL, readThemeColors } from '../engine/palette';
import { DEFAULT_NOTE_SIZE } from '../overlay/Overlay';

const FONT_SIZES: [string, number][] = [
  ['S', 12],
  ['M', 14],
  ['L', 18],
  ['XL', 24],
  ['2XL', 32],
];
import { removeAnnotation, updateAnnotation, useStore } from '../state/store';
import { IconTrash } from './icons';

export function AnnotationEditor() {
  const id = useStore((s) => s.editingAnnotationId);
  const annotation = useStore((s) => s.view.annotations.find((a) => a.id === s.editingAnnotationId));
  const titleRef = useRef<HTMLInputElement>(null);
  const palette = CATEGORICAL[readThemeColors().name];

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
    top = Math.max(12, Math.min(stage.height - 300, top));
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
      <div className="editor-row">
        <span className="label">Size</span>
        <div className="segmented mini" role="group" aria-label="Font size">
          {FONT_SIZES.map(([label, px]) => (
            <button
              key={label}
              type="button"
              aria-pressed={(annotation.fontSize ?? DEFAULT_NOTE_SIZE) === px}
              title={`${px}px`}
              onClick={() => updateAnnotation(id, { fontSize: px })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {annotation.anchor.kind === 'free' && (
        <div className="editor-row">
          <span className="label">Style</span>
          <div className="segmented mini" role="group" aria-label="Note style">
            <button
              type="button"
              aria-pressed={annotation.style !== 'text'}
              onClick={() => updateAnnotation(id, { style: 'callout', dx: 60, dy: -50 })}
            >
              Callout
            </button>
            <button
              type="button"
              aria-pressed={annotation.style === 'text'}
              onClick={() => updateAnnotation(id, { style: 'text', dx: 0, dy: 0 })}
            >
              Text box
            </button>
          </div>
        </div>
      )}
      {annotation.anchor.kind !== 'free' && (
        <>
          <label className="switch-row" style={{ marginTop: 2 }}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Highlight these points"
              checked={!!annotation.highlight}
              onChange={(e) => updateAnnotation(id, { highlight: e.target.checked })}
            />
            <span>Highlight these points, grey out the rest</span>
          </label>
          {annotation.highlight && (
            <div className="swatch-row" role="group" aria-label="Highlight color">
              <button
                type="button"
                className="btn small swatch-btn"
                aria-pressed={!annotation.highlightColor}
                onClick={() => updateAnnotation(id, { highlightColor: null })}
              >
                Keep colors
              </button>
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch-pick"
                  style={{ background: c }}
                  aria-label={`Highlight in ${c}`}
                  aria-pressed={annotation.highlightColor === c}
                  onClick={() => updateAnnotation(id, { highlightColor: c })}
                />
              ))}
            </div>
          )}
        </>
      )}
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
