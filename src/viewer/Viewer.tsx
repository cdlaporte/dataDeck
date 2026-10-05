import { useEffect, useState } from 'react';
import { getEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import { DeckFormatError, parseDeck } from '../persist/deckFile';
import { gotoSlide, loadDeck, startPresentation, useStore } from '../state/store';
import { IconMaximize } from '../ui/icons';
import { Stage } from '../ui/Stage';
import { readViewerParams, type ViewerParams } from './params';

/**
 * Presenter-only DataDeck: loads one deck from a URL and shows it full-window, with no
 * editor. Used to publish finished decks on a website.
 */

const params = readViewerParams(window.location.search);

function applyTheme(theme: ViewerParams['theme']) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => getEngine()?.setTheme(readThemeColors()));
}

/** Leaves the viewer: to `back` if given, else the previous page. Returns false if there's nowhere to go. */
function leave(): boolean {
  // Inside an iframe, navigate the page that embeds the viewer.
  const target = window.top ?? window;
  try {
    if (params.back) {
      target.location.href = new URL(params.back, window.location.href).href;
      return true;
    }
    if (target.history.length > 1) {
      target.history.back();
      return true;
    }
  } catch {
    // A cross-origin parent page can't be navigated back from here.
  }
  return false;
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

async function openDeck(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the presentation (${res.status} ${res.statusText}).`);
  const deck = parseDeck(await res.text());
  if (!deck.dataset) throw new DeckFormatError('This deck has no dataset.');
  if (!deck.slides.length) throw new DeckFormatError('This deck has no slides.');
  if (deck.name) document.title = deck.name;
  loadDeck(deck);
  startPresentation(Math.min(Math.max(params.slide - 1, 0), deck.slides.length - 1));
}

function useViewerKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      if (s.mode !== 'present') return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key))
        gotoSlide(s.presentIndex + 1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) gotoSlide(s.presentIndex - 1);
      else if (e.key === 'Home') gotoSlide(0);
      else if (e.key === 'End') gotoSlide(s.slides.length - 1);
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key === 'Escape') leave();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The X in the presentation controls ends presenting; in the viewer that means leaving. */
function useExitLeaves() {
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (prev.mode !== 'present' || s.mode === 'present') return;
        if (!leave()) startPresentation(prev.presentIndex);
      }),
    [],
  );
}

export function Viewer() {
  const [error, setError] = useState<string | null>(null);
  const ready = useStore((s) => s.mode === 'present' && !!s.table);
  useViewerKeys();
  useExitLeaves();

  useEffect(() => {
    applyTheme(params.theme);
    if (!params.deck) {
      setError('No presentation was given. Add ?deck=<url of a .datadeck.json file> to the address.');
      return;
    }
    openDeck(params.deck).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not load the presentation.'),
    );
  }, []);

  if (error) {
    return (
      <div className="viewer-message" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="viewer-message" role="status">
        <p>Loading presentation…</p>
      </div>
    );
  }
  return (
    <div className="app presenting">
      <Stage />
      <button
        type="button"
        className="btn icon ghost viewer-fullscreen"
        aria-label="Toggle full screen"
        title="Full screen (F)"
        onClick={toggleFullscreen}
      >
        <IconMaximize />
      </button>
    </div>
  );
}
