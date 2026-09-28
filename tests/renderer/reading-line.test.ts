import { describe, it, expect } from 'vitest';
import { indexAtReadingLine } from '../../src/renderer/overlay/reading-line';

describe('indexAtReadingLine', () => {
  // span tops (px from the top of the scroll content), several words per line
  const tops = [0, 0, 0, 50, 50, 100, 100, 150];

  it('returns 0 for an empty script', () => {
    expect(indexAtReadingLine([], 200)).toBe(0);
  });

  it('returns 0 when the reading line is above the first word', () => {
    expect(indexAtReadingLine(tops, -10)).toBe(0);
  });

  it('returns the first word of the line the reading line falls on', () => {
    expect(indexAtReadingLine(tops, 60)).toBe(3);
    expect(indexAtReadingLine(tops, 100)).toBe(5);
  });

  it('returns the first word of the last line when scrolled past the end', () => {
    expect(indexAtReadingLine(tops, 999)).toBe(7);
  });

  // A sentence can start mid-line; snapping it back to the line start would
  // make "next sentence" land where it already was.
  it('keeps the current position when it is already on the reading line', () => {
    expect(indexAtReadingLine(tops, 60, 4)).toBe(4);
    expect(indexAtReadingLine(tops, 60, 1)).toBe(3); // current on another line
  });
});
