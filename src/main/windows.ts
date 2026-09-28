import { BrowserWindow } from 'electron';
import { windowModeFor } from './window-mode';

export function createOverlayWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 300,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  });
  win.setContentProtection(true);
  win.loadFile(htmlPath);
  return win;
}

export function createControlWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'Prompter — Kontrol',
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(htmlPath);
  return win;
}

export function applyWindowMode(
  win: BrowserWindow,
  s: { alwaysOnTop: boolean; clickThrough: boolean }
): void {
  win.setContentProtection(true);
  const mode = windowModeFor(s);
  if (mode.alwaysOnTop) {
    win.setAlwaysOnTop(true, mode.level ?? 'screen-saver');
    win.setSkipTaskbar(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
  }
  // R7: always forward, so main can flip ignore on/off live via
  // mouse-over-controls without re-applying the whole window mode.
  win.setIgnoreMouseEvents(mode.ignoreMouse, { forward: true });
}
