import { get as idbGet, set as idbSet } from 'idb-keyval';
import { loadDeck, toDeck, useStore, type ThemePref } from '../state/store';
import type { Deck } from '../state/types';
import type { MotionPreset } from '../engine/motion';

const DECK_KEY = 'datadeck:current';
const THEME_KEY = 'datadeck:theme';
const MOTION_KEY = 'datadeck:motion';
const STRIP_KEY = 'datadeck:strip-compact';

/** Restores the last deck from IndexedDB, then autosaves changes (debounced). */
export async function initPersistence() {
  try {
    const [deck, theme, motion, stripCompact] = await Promise.all([
      idbGet<Deck>(DECK_KEY),
      idbGet<ThemePref>(THEME_KEY),
      idbGet<MotionPreset>(MOTION_KEY),
      idbGet<boolean>(STRIP_KEY),
    ]);
    if (stripCompact !== undefined) useStore.setState({ stripCompact });
    if (theme) useStore.setState({ theme });
    if (motion) useStore.setState({ motion });
    if (deck?.dataset) loadDeck(deck);
  } catch (err) {
    console.warn('Could not restore saved deck', err);
  }
  useStore.setState({ hydrated: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) void idbSet(THEME_KEY, s.theme).catch(() => {});
    if (s.motion !== prev.motion) void idbSet(MOTION_KEY, s.motion).catch(() => {});
    if (s.stripCompact !== prev.stripCompact) void idbSet(STRIP_KEY, s.stripCompact).catch(() => {});
    const changed =
      s.dataset !== prev.dataset ||
      s.slides !== prev.slides ||
      s.fieldOverrides !== prev.fieldOverrides ||
      s.categoryColors !== prev.categoryColors ||
      s.deckName !== prev.deckName;
    if (!changed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void idbSet(DECK_KEY, toDeck()).catch((err) => console.warn('Autosave failed', err));
    }, 600);
  });
}
