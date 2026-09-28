import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, DEFAULT_SETTINGS } from '../../src/main/settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prompter-'));
});

describe('Store', () => {
  it('returns defaults when nothing is saved', () => {
    const s = new Store(dir);
    expect(s.readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(s.readScript()).toBe('');
  });

  it('round-trips settings', () => {
    const s = new Store(dir);
    const next = { ...DEFAULT_SETTINGS, bgOpacity: 70, fontWeight: 800 };
    s.writeSettings(next);
    expect(new Store(dir).readSettings()).toEqual(next);
  });

  it('round-trips the script', () => {
    const s = new Store(dir);
    s.writeScript('Halo dunia');
    expect(new Store(dir).readScript()).toBe('Halo dunia');
  });

  it('tolerates corrupt settings json', () => {
    const s = new Store(dir);
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(s.readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
