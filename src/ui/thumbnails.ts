import { Engine } from '../engine/Engine';
import { getEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import { sanitizeView, setSlideThumbnail, useStore } from '../state/store';

/** Collision relaxation after jumping bubbles onto their targets. */
const RELAX_TICKS = 160;

let running = false;
let again = false;

/**
 * Redraws slide previews whose theme doesn't match the current one, using a
 * hidden offscreen engine so the live stage is never disturbed.
 */
export function refreshThumbnails() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void redrawStale().finally(() => {
    running = false;
    if (again) {
      again = false;
      refreshThumbnails();
    }
  });
}

async function redrawStale() {
  const start = useStore.getState();
  const theme = readThemeColors();
  const stale = start.slides.filter((s) => s.thumbnailTheme !== theme.name);
  if (!start.table || !stale.length) return;

  const live = getEngine()?.container.getBoundingClientRect();
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.round(live?.width || 1000)}px;height:${Math.round(live?.height || 640)}px;pointer-events:none;`;
  document.body.append(host);
  useStore.setState({ refreshingThumbnails: true });
  const engine = new Engine(host, {}, { headless: true });
  try {
    engine.setTheme(theme);
    for (const slide of stale) {
      const s = useStore.getState();
      // Stop if the data changed or the theme flipped again (a new run follows).
      if (s.table !== start.table || readThemeColors().name !== theme.name) break;
      const current = s.slides.find((x) => x.id === slide.id);
      if (!current || !s.table) continue;
      const view = sanitizeView(current.view, s.table);
      if (view.layout.mode === 'tsne' && !view.layout.coords) continue;
      engine.setTable(s.table, view);
      engine.jumpToTargets();
      engine.settle(RELAX_TICKS);
      const thumbnail = await engine.captureThumbnail(view.title);
      if (thumbnail) setSlideThumbnail(slide.id, thumbnail, theme.name);
      // Yield between slides so the UI stays responsive.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    engine.dispose();
    host.remove();
    useStore.setState({ refreshingThumbnails: false });
  }
}

/** Keeps previews in the current theme: after theme changes and when decks load. */
export function initThumbnailRefresh() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refreshThumbnails, 400);
  };
  useStore.subscribe((s, prev) => {
    if (s.slides === prev.slides && s.table === prev.table) return;
    const theme = readThemeColors().name;
    if (s.slides.some((sl) => sl.thumbnailTheme !== theme)) schedule();
  });
  schedule();
  return schedule;
}
