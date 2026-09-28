import { describe, it, expect } from 'vitest';
import { progressLabel } from '../../src/renderer/overlay/progress';

describe('progressLabel', () => {
  it('shows position, total and percentage', () => {
    expect(progressLabel(12, 340)).toBe('12 / 340 kata (4%)');
  });

  it('handles an empty script', () => {
    expect(progressLabel(0, 0)).toBe('0 / 0 kata (0%)');
  });

  it('reaches 100% at the end and never exceeds it', () => {
    expect(progressLabel(340, 340)).toBe('340 / 340 kata (100%)');
    expect(progressLabel(400, 340)).toBe('340 / 340 kata (100%)');
  });
});
