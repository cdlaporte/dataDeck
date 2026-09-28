import { Engine } from '../engine/Engine';
import { getEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import { sanitizeView, setSlideThumbnail, slideStyleKey, thumbnailStyleKey, useStore } from '../state/store';

/** How previews should currently look: theme plus custom colours. */
function currentStyle() {
  const theme = readThemeColors();
  return { theme, key: thumbnailStyleKey(theme.name, useStore.getState().categoryColors) };
}

/** Collision relaxation after jumping bubbles onto their targets. */
const RELAX_TICKS = 160;

let running = false;
let again = false;

/**
 * Redraws slide previews drawn in another theme or with other custom colours, using a
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
  const { theme, key } = currentStyle();
  const stale = start.slides.filter((s) => slideStyleKey(s) !== key);
  if (!start.table || !stale.length) return;

  const live = getEngine()?.size();
  const fallback = { width: live?.width || 1000, height: live?.height || 640 };
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  // Each preview renders at its slide's frame (the size it was snapshotted at).
  const sizeHost = (f: { width: number; height: number }) => {
    host.style.width = `${Math.round(f.width)}px`;
    host.style.height = `${Math.round(f.height)}px`;
  };
  sizeHost(fallback);
  document.body.append(host);
  useStore.setState({ refreshingThumbnails: true });
  const engine = new Engine(host, {}, { headless: true });
  try {
    engine.setTheme(theme);
    engine.setCategoryColors(start.categoryColors);
    for (const slide of stale) {
      const s = useStore.getState();
      // Stop if the data, theme or colours changed again (a new run follows).
      if (s.table !== start.table || currentStyle().key !== key) break;
      const current = s.slides.find((x) => x.id === slide.id);
      if (!current || !s.table) continue;
      const view = sanitizeView(current.view, s.table);
      if (view.layout.mode === 'tsne' && !view.layout.coords) continue;
      sizeHost(current.frame ?? fallback);
      engine.syncSize();
      engine.setTable(s.table, view);
      engine.jumpToTargets();
      engine.settle(RELAX_TICKS);
      const thumbnail = await engine.captureThumbnail(view.title);
      if (thumbnail) setSlideThumbnail(slide.id, thumbnail, theme.name, key);
      // Yield between slides so the UI stays responsive.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    engine.dispose();
    host.remove();
    useStore.setState({ refreshingThumbnails: false });
  }
}

/** Keeps previews current: after theme or colour changes and when decks load. */
export function initThumbnailRefresh() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refreshThumbnails, 400);
  };
  useStore.subscribe((s, prev) => {
    if (s.slides === prev.slides && s.table === prev.table && s.categoryColors === prev.categoryColors)
      return;
    const { key } = currentStyle();
    if (s.slides.some((sl) => slideStyleKey(sl) !== key)) schedule();
  });
  schedule();
  return schedule;
}
