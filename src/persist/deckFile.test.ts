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
    slides: [
      {
        id: 's1',
        thumbnail: null,
        view: {
          ...defaultView(),
          title: 'Hello',
          layout: { mode: 'tsne', fields: ['a'], params: { perplexity: 5, epsilon: 10, iterations: 100 }, coords: [0.1, null] },
        },
      },
    ],
  };

  it('round-trips', () => {
    expect(parseDeck(serializeDeck(deck))).toEqual(deck);
  });

  it('rejects other files', () => {
    expect(() => parseDeck('nope')).toThrow(/JSON/);
    expect(() => parseDeck('{"format":"other"}')).toThrow(/not a DataDeck/);
    expect(() => parseDeck('{"format":"datadeck","version":2,"slides":[]}')).toThrow(/version/);
  });
});
