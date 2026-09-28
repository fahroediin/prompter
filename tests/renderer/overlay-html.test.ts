import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '../../src/renderer/overlay/overlay.html'), 'utf8');

function rule(selector: string): string {
  const m = html.match(new RegExp(`\\n\\s*${selector.replace('.', '\\.')}\\s*\\{[^}]*\\}`));
  expect(m, `CSS rule for ${selector}`).not.toBeNull();
  return m![0];
}

describe('overlay.html', () => {
  it('#view is positioned so span offsetTop is measured within the scroll container', () => {
    expect(rule('#view')).toMatch(/position:\s*relative/);
  });

  // A drag region swallows wheel and click events on Windows, so only the top
  // bar may drag the window; the text must stay scrollable and clickable.
  it('only the top bar is a drag region; the body and text view are not', () => {
    expect(rule('body')).not.toMatch(/-webkit-app-region:\s*drag/);
    expect(rule('#view')).not.toMatch(/-webkit-app-region:\s*drag/);
    expect(rule('.bar')).toMatch(/-webkit-app-region:\s*drag/);
  });

  it('the top bar holds back, pause and forward buttons', () => {
    const bar = html.match(/<div class="bar controls">[\s\S]*?<\/div>\s*<div id="view"/);
    expect(bar).not.toBeNull();
    const ids = [...bar![0].matchAll(/<button id="(\w+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['prevBtn', 'pauseBtn', 'nextBtn']);
  });

  it('the footer has a seek slider and a progress label', () => {
    expect(html).toMatch(/<input id="seek" type="range"/);
    expect(html).toMatch(/id="progress"/);
  });

  // The reading line sits at 1/3 of the window. Without matching top padding
  // the first lines start above it and syncing from scroll marks them read.
  it('#view top padding matches the reading line so word 0 can sit on it', () => {
    expect(rule('#view')).toMatch(/padding:\s*33\.333vh\b/);
    expect(rule('.reading-line')).toMatch(/top:\s*33\.333%/);
  });

  it('shows a reading line guide that does not take pointer events', () => {
    expect(rule('.reading-line')).toMatch(/pointer-events:\s*none/);
  });
});
