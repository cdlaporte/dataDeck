import { get as idbGet, set as idbSet } from 'idb-keyval';
import { loadDeck, toDeck, useStore, type ThemePref } from '../state/store';
import type { Deck } from '../state/types';

const DECK_KEY = 'datadeck:current';
const THEME_KEY = 'datadeck:theme';

/** Restores the last deck from IndexedDB, then autosaves changes (debounced). */
export async function initPersistence() {
  try {
    const [deck, theme] = await Promise.all([idbGet<Deck>(DECK_KEY), idbGet<ThemePref>(THEME_KEY)]);
    if (theme) useStore.setState({ theme });
    if (deck?.dataset) loadDeck(deck);
  } catch (err) {
    console.warn('Could not restore saved deck', err);
  }
  useStore.setState({ hydrated: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s, prev) => {
    if (s.theme !== prev.theme) void idbSet(THEME_KEY, s.theme).catch(() => {});
    const changed =
      s.dataset !== prev.dataset || s.slides !== prev.slides || s.fieldOverrides !== prev.fieldOverrides || s.deckName !== prev.deckName;
    if (!changed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void idbSet(DECK_KEY, toDeck()).catch((err) => console.warn('Autosave failed', err));
    }, 600);
  });
}
