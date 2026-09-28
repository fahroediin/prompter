import { describe, it, expect } from 'vitest';
import { lastSentenceRange } from '../../src/renderer/overlay/sentence-range';

describe('lastSentenceRange', () => {
  // "Halo dunia. Ini kalimat dua! Dan tiga?" -> sentenceStarts [0, 2, 5]
  // tokens: 0 Halo, 1 dunia, 2 Ini, 3 kalimat, 4 dua, 5 Dan, 6 tiga
  const sentenceStarts = [0, 2, 5];
  const tokenCount = 7;

  it('returns null when position is 0 (nothing spoken yet)', () => {
    expect(lastSentenceRange(sentenceStarts, 0, tokenCount)).toBeNull();
  });

  it('returns null when tokenCount is 0', () => {
    expect(lastSentenceRange([0], 3, 0)).toBeNull();
  });

  it('returns the first sentence range when position-1 is within it', () => {
    // position=1 -> anchor=0 -> first sentence [0,2)
    expect(lastSentenceRange(sentenceStarts, 1, tokenCount)).toEqual([0, 2]);
  });

  it('returns the middle sentence range when position-1 is within it', () => {
    // position=4 -> anchor=3 -> second sentence [2,5)
    expect(lastSentenceRange(sentenceStarts, 4, tokenCount)).toEqual([2, 5]);
  });

  it('returns the middle sentence range when anchor is exactly its start', () => {
    // position=3 -> anchor=2 -> second sentence starts exactly at 2
    expect(lastSentenceRange(sentenceStarts, 3, tokenCount)).toEqual([2, 5]);
  });

  it('returns the last sentence range extending to tokenCount', () => {
    // position=7 (end of script) -> anchor=6 -> third sentence [5,7)
    expect(lastSentenceRange(sentenceStarts, 7, tokenCount)).toEqual([5, 7]);
  });

  it('handles a single-sentence script', () => {
    expect(lastSentenceRange([0], 3, 5)).toEqual([0, 5]);
  });

  it('handles position beyond tokenCount by clamping to the last sentence', () => {
    expect(lastSentenceRange(sentenceStarts, 100, tokenCount)).toEqual([5, 7]);
  });
});
