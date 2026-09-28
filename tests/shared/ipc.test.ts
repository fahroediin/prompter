import { describe, it, expect } from 'vitest';
import { IPC } from '../../src/shared/ipc';

describe('IPC channels', () => {
  it('all channel values are unique strings', () => {
    const channels = Object.values(IPC);

    // Check all are strings
    channels.forEach(channel => {
      expect(typeof channel).toBe('string');
    });

    // Check all are unique
    const uniqueChannels = new Set(channels);
    expect(uniqueChannels.size).toBe(channels.length);
  });
});
