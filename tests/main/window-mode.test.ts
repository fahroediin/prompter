import { describe, it, expect } from 'vitest';
import { windowModeFor } from '../../src/main/window-mode';

describe('windowModeFor', () => {
  it('always-on-top on: sets screen-saver level and skips taskbar', () => {
    const mode = windowModeFor({ alwaysOnTop: true, clickThrough: false });
    expect(mode).toEqual({
      alwaysOnTop: true,
      level: 'screen-saver',
      skipTaskbar: true,
      ignoreMouse: false,
    });
  });

  it('always-on-top off: no level, does not skip taskbar', () => {
    const mode = windowModeFor({ alwaysOnTop: false, clickThrough: false });
    expect(mode).toEqual({
      alwaysOnTop: false,
      level: null,
      skipTaskbar: false,
      ignoreMouse: false,
    });
  });

  it('click-through on: ignoreMouse is true regardless of always-on-top', () => {
    expect(windowModeFor({ alwaysOnTop: true, clickThrough: true }).ignoreMouse).toBe(true);
    expect(windowModeFor({ alwaysOnTop: false, clickThrough: true }).ignoreMouse).toBe(true);
  });

  it('click-through off: ignoreMouse is false', () => {
    expect(windowModeFor({ alwaysOnTop: true, clickThrough: false }).ignoreMouse).toBe(false);
  });
});
