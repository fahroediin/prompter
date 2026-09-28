import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '../../src/renderer/overlay/overlay.html'), 'utf8');

describe('overlay.html', () => {
  it('#view is positioned so span offsetTop is measured within the scroll container', () => {
    const match = html.match(/#view\s*\{[^}]*\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/position:\s*relative/);
  });
});
