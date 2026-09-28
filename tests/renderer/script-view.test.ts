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
