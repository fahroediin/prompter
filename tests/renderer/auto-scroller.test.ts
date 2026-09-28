import { describe, it, expect } from 'vitest';
import { AutoScroller } from '../../src/renderer/overlay/auto-scroller';

function fakeRaf() {
  let handle = 0;
  const cbs = new Map<number, (t: number) => void>();
  const raf = (cb: (t: number) => void) => {
    handle += 1;
    cbs.set(handle, cb);
    return handle;
  };
  const cancel = (h: number) => cbs.delete(h);
  const tick = (t: number) => {
    const current = [...cbs.entries()];
    cbs.clear();
    current.forEach(([, cb]) => cb(t));
  };
  return { raf, cancel, tick };
}

describe('AutoScroller', () => {
  it('advances scrollTop at the configured speed', () => {
    const el = { scrollTop: 0 };
    const { raf, cancel, tick } = fakeRaf();
    const s = new AutoScroller(el, { raf, cancel });
    s.start(100); // 100 px/sec
    tick(1000); // first frame sets baseline
    tick(2000); // +1s -> +100px
    expect(el.scrollTop).toBeCloseTo(100, 0);
    s.stop();
    expect(s.running).toBe(false);
  });

  it('stop halts further movement', () => {
    const el = { scrollTop: 0 };
    const { raf, cancel, tick } = fakeRaf();
    const s = new AutoScroller(el, { raf, cancel });
    s.start(100);
    tick(1000);
    s.stop();
    tick(3000);
    expect(el.scrollTop).toBe(0);
  });

  it('start() while already running does not double the scroll rate', () => {
    const el = { scrollTop: 0 };
    const { raf, cancel, tick } = fakeRaf();
    const s = new AutoScroller(el, { raf, cancel });
    s.start(100); // 100 px/sec
    tick(1000); // first frame sets baseline
    s.start(100); // start again while running (cancels pending frame, resets last=-1)
    tick(2000); // new baseline from t=2000
    tick(3000); // +1s from baseline -> +100px
    expect(el.scrollTop).toBeCloseTo(100, 0);
  });
});
