import { describe, expect, it } from 'vitest';
import { parseDeck, serializeDeck } from './deckFile';
import { defaultView, type Deck } from '../state/types';

describe('deck file', () => {
  const deck: Deck = {
    format: 'datadeck',
    version: 1,
    name: 'Test',
    dataset: { id: 'd1', name: 'x', source: 'upload', columns: ['a'], rows: [{ a: '1' }] },
    fieldOverrides: { a: 'categorical' },
    categoryColors: { a: { '1': '#123abc' } },
    slides: [
      {
        id: 's1',
        thumbnail: null,
        view: {
          ...defaultView(),
          title: 'Hello',
          reference: 'median',
          layout: {
            mode: 'tsne',
            fields: ['a'],
            params: { perplexity: 5, epsilon: 10, iterations: 100 },
            coords: [0.1, null],
          },
        },
      },
    ],
  };

  it('round-trips', () => {
    expect(parseDeck(serializeDeck(deck))).toEqual(deck);
  });

  it('loads older decks without colours and drops malformed ones', () => {
    const { categoryColors: _omit, ...old } = deck;
    void _omit;
    expect(parseDeck(serializeDeck(old as Deck)).categoryColors).toEqual({});
    const bad = { ...deck, categoryColors: { a: { '1': 'red; x', '2': '#00ff00' }, b: 5 } };
    expect(parseDeck(JSON.stringify(bad)).categoryColors).toEqual({ a: { '2': '#00ff00' } });
  });

  it('rejects other files', () => {
    expect(() => parseDeck('nope')).toThrow(/JSON/);
    expect(() => parseDeck('{"format":"other"}')).toThrow(/not a DataDeck/);
    expect(() => parseDeck('{"format":"datadeck","version":2,"slides":[]}')).toThrow(/version/);
  });
});
