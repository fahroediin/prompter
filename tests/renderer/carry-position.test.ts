import { describe, it, expect } from 'vitest';
import { carryPosition } from '../../src/renderer/overlay/carry-position';

describe('carryPosition', () => {
  it('carries the old position forward when it still fits', () => {
    expect(carryPosition(5, 20)).toBe(5);
  });

  it('clamps to the new token count when the script got shorter', () => {
    expect(carryPosition(50, 10)).toBe(10);
  });

  it('stays at 0 on first script load', () => {
    expect(carryPosition(0, 100)).toBe(0);
  });

  it('clamps a negative position to 0', () => {
    expect(carryPosition(-3, 10)).toBe(0);
  });

  it('handles an empty new script (tokenCount 0)', () => {
    expect(carryPosition(7, 0)).toBe(0);
  });
});
