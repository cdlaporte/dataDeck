import { useState } from 'react';
import { deleteSlide, duplicateSlide, isViewDirty, moveSlide, selectSlide, useStore } from '../state/store';
import { snapshot } from './actions';
import { IconCamera, IconChevronDown, IconChevronUp, IconCopy, IconTrash } from './icons';

export function SlideStrip() {
  const slides = useStore((s) => s.slides);
  const activeId = useStore((s) => s.activeSlideId);
  const dirty = useStore(isViewDirty);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const compact = useStore((s) => s.stripCompact);
  const refreshing = useStore((s) => s.refreshingThumbnails);

  return (
    <footer className={`slide-strip${compact ? ' compact' : ''}`} aria-label="Slides">
      <div className="slide-strip-actions">
        <button
          type="button"
          className={`btn primary${compact ? ' small' : ''}`}
          onClick={() => void snapshot()}
          title="Snapshot the current view as a new slide (S)"
        >
          <IconCamera size={compact ? 14 : 16} /> Snapshot
        </button>
        <div className="strip-meta">
          <span className="section-hint">
            {refreshing
              ? 'Updating previews…'
              : `${slides.length} ${slides.length === 1 ? 'slide' : 'slides'}`}
          </span>
          <button
            type="button"
            className="btn icon ghost small"
            aria-label={compact ? 'Show slide previews' : 'Compact slide strip'}
            title={compact ? 'Show slide previews' : 'Compact: slide numbers only'}
            aria-pressed={compact}
            onClick={() => useStore.setState({ stripCompact: !compact })}
          >
            {compact ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
          </button>
        </div>
      </div>
      <div
        className="slides"
        role="list"
        onDragOver={(e) => {
          if (dragFrom === null) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropAt(slides.length);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragFrom !== null && dropAt !== null)
            moveSlide(dragFrom, dropAt > dragFrom ? dropAt - 1 : dropAt);
          setDragFrom(null);
          setDropAt(null);
        }}
      >
        {slides.length === 0 && (
          <div className="slides-empty">
            Arrange a view you like, then press <b>Snapshot</b> (or <span className="kbd">S</span>) to capture
            it as a slide.
          </div>
        )}
        {slides.map((slide, i) => {
          const active = slide.id === activeId;
          return (
            <div
              key={slide.id}
              role="listitem"
              className={`${compact ? 'slide-chip' : 'slide-thumb'}${active ? ' active' : ''}${dropAt === i && dragFrom !== null ? ' drop-before' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientX < rect.left + rect.width / 2 ? i : i + 1);
              }}
            >
              {compact ? (
                <button
                  type="button"
                  className="chip"
                  aria-label={`Slide ${i + 1}${slide.view.title ? `: ${slide.view.title}` : ''}`}
                  aria-current={active}
                  onClick={() => selectSlide(slide.id)}
                >
                  <b>{i + 1}</b>
                  <span>{slide.view.title || describeLayout(slide.view.layout)}</span>
                  {active && dirty && <i className="chip-dirty" title="Edited" />}
                  {slide.thumbnail && (
                    <span className="chip-preview" aria-hidden="true">
                      <img src={slide.thumbnail} alt="" draggable={false} />
                    </span>
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="frame"
                    aria-label={`Slide ${i + 1}${slide.view.title ? `: ${slide.view.title}` : ''}`}
                    aria-current={active}
                    onClick={() => selectSlide(slide.id)}
                  >
                    {slide.thumbnail ? <img src={slide.thumbnail} alt="" draggable={false} /> : null}
                    {active && dirty && <span className="dirty">Edited</span>}
                  </button>
                  <div className="caption">
                    <b>{i + 1}</b>
                    <span>{slide.view.title || describeLayout(slide.view.layout)}</span>
                  </div>
                </>
              )}
              <div className="thumb-actions">
                <button
                  type="button"
                  className="btn icon small"
                  aria-label="Duplicate slide"
                  title="Duplicate"
                  onClick={() => duplicateSlide(slide.id)}
                >
                  <IconCopy size={13} />
                </button>
                <button
                  type="button"
                  className="btn icon small danger"
                  aria-label="Delete slide"
                  title="Delete"
                  onClick={() => deleteSlide(slide.id)}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </footer>
  );
}

function describeLayout(layout: import('../state/types').LayoutSpec): string {
  switch (layout.mode) {
    case 'cluster':
      return 'Cluster';
    case '1d':
      return layout.field;
    case '2d':
      return `${layout.y} × ${layout.x}`;
    case 'tsne':
      return `t-SNE (${layout.fields.length} dims)`;
  }
}
