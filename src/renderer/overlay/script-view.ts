import type { Token } from '../../core/normalize';

export class ScriptView {
  private root: HTMLElement;
  private wordsEl: HTMLElement;
  private statusEl: HTMLElement;
  private viewEl: HTMLElement;
  private spans: HTMLSpanElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.wordsEl = root.querySelector('.words') as HTMLElement;
    this.statusEl = root.querySelector('.status') as HTMLElement;
    this.viewEl = (root.querySelector('#view') as HTMLElement) ?? this.wordsEl;
  }

  setScript(tokens: readonly Token[]): void {
    this.wordsEl.textContent = '';
    this.spans = tokens.map((t, i) => {
      const span = document.createElement('span');
      span.textContent = t.raw + ' ';
      span.dataset.i = String(i);
      this.wordsEl.appendChild(span);
      return span;
    });
  }

  setPosition(pos: number): void {
    this.spans.forEach((span, i) => {
      span.classList.toggle('read', i < pos);
      span.classList.toggle('active', i === pos);
    });
    const active = this.spans[pos];
    if (active) {
      const target = active.offsetTop - this.viewEl.clientHeight / 3;
      const top = Math.max(0, target);
      if (typeof this.viewEl.scrollTo === 'function') {
        this.viewEl.scrollTo({ top, behavior: 'smooth' });
      } else {
        this.viewEl.scrollTop = top;
      }
    }
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setHighlight(range: [number, number] | null): void {
    this.spans.forEach((span, i) => {
      const inRange = range !== null && i >= range[0] && i < range[1];
      span.classList.toggle('highlight', inRange);
    });
  }

  applySettings(s: { bgOpacity: number; fontWeight: number; fontSize: number; margin: number }): void {
    this.root.style.setProperty('--bg-opacity', String(s.bgOpacity / 100));
    this.root.style.setProperty('--font-weight', String(s.fontWeight));
    this.root.style.setProperty('--font-size', `${s.fontSize}px`);
    this.root.style.setProperty('--margin', `${s.margin}px`);
  }
}
