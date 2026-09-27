import { getEngine } from '../engine/instance';
import { readThemeColors } from '../engine/palette';
import { useStore, type ThemePref } from '../state/store';
import { initThumbnailRefresh, refreshThumbnails } from './thumbnails';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  getEngine()?.setTheme(readThemeColors());
  refreshThumbnails();
}

/** Applies the theme preference to <html> and keeps the engine's colours in sync. */
export function initTheme() {
  apply(useStore.getState().theme);
  initThumbnailRefresh();
  useStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) apply(s.theme);
  });
  media.addEventListener('change', () => {
    if (useStore.getState().theme === 'system') apply('system');
  });
}

export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}
