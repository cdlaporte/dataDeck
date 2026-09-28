import type { CategoryColors, Deck } from '../state/types';

export const DECK_EXTENSION = '.datadeck.json';

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(deck);
}

export class DeckFormatError extends Error {}

/** Parses and validates a .datadeck file. */
export function parseDeck(text: string): Deck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeckFormatError('This file is not valid JSON.');
  }
  const d = raw as Partial<Deck>;
  if (!d || typeof d !== 'object' || d.format !== 'datadeck')
    throw new DeckFormatError('This is not a DataDeck file.');
  if (d.version !== 1) throw new DeckFormatError(`Unsupported DataDeck version: ${String(d.version)}.`);
  if (!Array.isArray(d.slides)) throw new DeckFormatError('The deck has no slides array.');
  const ds = d.dataset;
  if (ds && (!Array.isArray(ds.columns) || !Array.isArray(ds.rows)))
    throw new DeckFormatError('The deck dataset is malformed.');
  return {
    format: 'datadeck',
    version: 1,
    name: typeof d.name === 'string' ? d.name : 'Untitled deck',
    dataset: ds ?? null,
    fieldOverrides: d.fieldOverrides ?? {},
    categoryColors: cleanColors(d.categoryColors),
    slides: d.slides,
  };
}

/** Keeps only well-formed field → value → colour string entries. */
function cleanColors(raw: unknown): CategoryColors {
  const out: CategoryColors = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [field, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!values || typeof values !== 'object') continue;
    const entries = Object.entries(values as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && /^#[0-9a-f]{3,8}$/i.test(e[1]),
    );
    if (entries.length) out[field] = Object.fromEntries(entries);
  }
  return out;
}

export function downloadDeck(deck: Deck) {
  const blob = new Blob([serializeDeck(deck)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}${DECK_EXTENSION}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
