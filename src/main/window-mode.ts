export type WindowModeInput = { alwaysOnTop: boolean; clickThrough: boolean };

export type WindowModeDecision = {
  alwaysOnTop: boolean;
  level: 'screen-saver' | null;
  skipTaskbar: boolean;
  ignoreMouse: boolean;
};

/**
 * Pure decision function for how applyWindowMode should configure a window,
 * given the current settings. Kept separate from windows.ts (which calls the
 * Electron APIs) so it is unit-testable without a BrowserWindow instance.
 */
export function windowModeFor(s: WindowModeInput): WindowModeDecision {
  return {
    alwaysOnTop: s.alwaysOnTop,
    level: s.alwaysOnTop ? 'screen-saver' : null,
    skipTaskbar: s.alwaysOnTop,
    ignoreMouse: s.clickThrough,
  };
}
