import { useEffect, useState } from 'react';
import { exitPresentation, gotoSlide, useStore } from '../state/store';
import { IconChevronLeft, IconChevronRight, IconX } from './icons';

export function PresentControls() {
  const index = useStore((s) => s.presentIndex);
  const count = useStore((s) => s.slides.length);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener('pointermove', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
    };
  }, []);

  return (
    <>
      <div className={`present-controls${idle ? ' idle' : ''}`} role="toolbar" aria-label="Presentation controls">
        <button type="button" className="btn icon ghost" aria-label="Previous slide" disabled={index === 0} onClick={() => gotoSlide(index - 1)}>
          <IconChevronLeft />
        </button>
        <span className="present-count">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          className="btn icon ghost"
          aria-label="Next slide"
          disabled={index >= count - 1}
          onClick={() => gotoSlide(index + 1)}
        >
          <IconChevronRight />
        </button>
        <button type="button" className="btn icon ghost" aria-label="Exit presentation" onClick={exitPresentation}>
          <IconX />
        </button>
      </div>
      <div className="present-progress" aria-hidden="true">
        <i style={{ width: `${((index + 1) / Math.max(1, count)) * 100}%` }} />
      </div>
    </>
  );
}
