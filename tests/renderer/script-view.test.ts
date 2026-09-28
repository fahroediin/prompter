// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptView } from '../../src/renderer/overlay/script-view';
import { normalize } from '../../src/core/normalize';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML =
    '<div class="badge">PAUSED</div><div id="view"><div class="words"></div></div><div class="status"></div>';
  root = document.body;
});

describe('ScriptView', () => {
  it('renders one span per token', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    expect(root.querySelectorAll('.words span').length).toBe(3);
  });

  it('marks read + active by position', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    v.setPosition(2);
    const spans = root.querySelectorAll('.words span');
    expect(spans[0].classList.contains('read')).toBe(true);
    expect(spans[1].classList.contains('read')).toBe(true);
    expect(spans[2].classList.contains('active')).toBe(true);
  });

  it('toggles paused class', () => {
    const v = new ScriptView(root);
    v.setPaused(true);
    expect(root.classList.contains('paused')).toBe(true);
    v.setPaused(false);
    expect(root.classList.contains('paused')).toBe(false);
  });

  it('applySettings sets CSS variables', () => {
    const v = new ScriptView(root);
    v.applySettings({ bgOpacity: 70, fontWeight: 800, fontSize: 40, margin: 60 });
    expect(root.style.getPropertyValue('--bg-opacity')).toBe('0.7');
    expect(root.style.getPropertyValue('--font-weight')).toBe('800');
    expect(root.style.getPropertyValue('--font-size')).toBe('40px');
    expect(root.style.getPropertyValue('--margin')).toBe('60px');
  });

  it('setStatus writes and clears the indicator', () => {
    const v = new ScriptView(root);
    v.setStatus('Listener offline');
    expect(root.querySelector('.status')!.textContent).toBe('Listener offline');
    v.setStatus('');
    expect(root.querySelector('.status')!.textContent).toBe('');
  });

  it('setPosition does not throw when scrollTo is unimplemented (jsdom)', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    expect(() => v.setPosition(1)).not.toThrow();
  });

  it('setPosition with scroll: false marks words without moving the scroll', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    const viewEl = root.querySelector('#view') as HTMLElement;
    viewEl.scrollTop = 50;
    v.setPosition(1, { scroll: false });
    expect(viewEl.scrollTop).toBe(50);
    expect(root.querySelectorAll('.words span')[1].classList.contains('active')).toBe(true);
    v.setPosition(1);
    expect(viewEl.scrollTop).toBe(0);
  });

  it('positionAtReadingLine maps the word at 1/3 of the viewport to its index', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('satu dua tiga empat'));
    const viewEl = root.querySelector('#view') as HTMLElement;
    // jsdom has no layout: give each span a top and the view a height/scroll.
    const spans = root.querySelectorAll<HTMLElement>('.words span');
    [0, 40, 80, 120].forEach((top, i) =>
      Object.defineProperty(spans[i], 'offsetTop', { value: top, configurable: true })
    );
    Object.defineProperty(viewEl, 'clientHeight', { value: 90, configurable: true });
    viewEl.scrollTop = 60; // reading line = 60 + 90/3 = 90 -> word at top 80
    expect(v.positionAtReadingLine()).toBe(2);
  });

  describe('setHighlight', () => {
    it('marks exactly the spans in [start, end)', () => {
      const v = new ScriptView(root);
      v.setScript(normalize('satu dua tiga empat lima'));
      v.setHighlight([1, 3]);
      const spans = root.querySelectorAll('.words span');
      expect(spans[0].classList.contains('highlight')).toBe(false);
      expect(spans[1].classList.contains('highlight')).toBe(true);
      expect(spans[2].classList.contains('highlight')).toBe(true);
      expect(spans[3].classList.contains('highlight')).toBe(false);
      expect(spans[4].classList.contains('highlight')).toBe(false);
    });

    it('a second call replaces the previous range', () => {
      const v = new ScriptView(root);
      v.setScript(normalize('satu dua tiga empat lima'));
      v.setHighlight([0, 2]);
      v.setHighlight([3, 5]);
      const spans = root.querySelectorAll('.words span');
      expect(spans[0].classList.contains('highlight')).toBe(false);
      expect(spans[1].classList.contains('highlight')).toBe(false);
      expect(spans[2].classList.contains('highlight')).toBe(false);
      expect(spans[3].classList.contains('highlight')).toBe(true);
      expect(spans[4].classList.contains('highlight')).toBe(true);
    });

    it('null clears all highlights', () => {
      const v = new ScriptView(root);
      v.setScript(normalize('satu dua tiga empat lima'));
      v.setHighlight([0, 5]);
      v.setHighlight(null);
      const spans = root.querySelectorAll('.words span');
      spans.forEach((s) => expect(s.classList.contains('highlight')).toBe(false));
    });
  });
});
