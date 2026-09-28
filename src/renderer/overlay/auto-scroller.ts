type Scrollable = { scrollTop: number };

export class AutoScroller {
  private el: Scrollable;
  private raf: (cb: (t: number) => void) => number;
  private cancel: (h: number) => void;
  private handle = 0;
  private speed = 0;
  private last = -1;
  private active = false;

  constructor(
    el: Scrollable,
    opts?: { raf?: (cb: (t: number) => void) => number; cancel?: (h: number) => void }
  ) {
    this.el = el;
    this.raf = opts?.raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = opts?.cancel ?? ((h) => cancelAnimationFrame(h));
  }

  get running(): boolean {
    return this.active;
  }

  setSpeed(pxPerSec: number): void {
    this.speed = pxPerSec;
  }

  start(pxPerSec: number): void {
    // Cancel existing animation if already running to prevent double-speed
    if (this.handle) this.cancel(this.handle);
    this.speed = pxPerSec;
    this.active = true;
    this.last = -1;
    this.handle = this.raf((t) => this.frame(t));
  }

  stop(): void {
    this.active = false;
    if (this.handle) this.cancel(this.handle);
    this.handle = 0;
  }

  private frame(t: number): void {
    if (!this.active) return;
    if (this.last >= 0) {
      const dt = (t - this.last) / 1000;
      this.el.scrollTop += this.speed * dt;
    }
    this.last = t;
    this.handle = this.raf((nt) => this.frame(nt));
  }
}
