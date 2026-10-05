import { describe, expect, it } from 'vitest';
import { readViewerParams } from './params';

describe('readViewerParams', () => {
  it('reads every option', () => {
    expect(readViewerParams('?deck=/decks/a.datadeck.json&slide=3&back=/&theme=dark')).toEqual({
      deck: '/decks/a.datadeck.json',
      slide: 3,
      back: '/',
      theme: 'dark',
    });
  });

  it('falls back to defaults for missing or bad values', () => {
    expect(readViewerParams('?slide=-2&theme=purple')).toEqual({
      deck: null,
      slide: 1,
      back: null,
      theme: null,
    });
  });
});
