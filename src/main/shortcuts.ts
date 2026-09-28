import { globalShortcut } from 'electron';

type Handlers = {
  toggleAlwaysOnTop(): void;
  togglePause(): void;
  next(): void;
  prev(): void;
};

export function registerShortcuts(h: Handlers): void {
  globalShortcut.register('CommandOrControl+Shift+T', h.toggleAlwaysOnTop);
  globalShortcut.register('CommandOrControl+Shift+Space', h.togglePause);
  globalShortcut.register('CommandOrControl+Shift+Right', h.next);
  globalShortcut.register('CommandOrControl+Shift+Left', h.prev);
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
