import { globalShortcut } from 'electron';

type Handlers = {
  toggleAlwaysOnTop(): void;
  togglePause(): void;
  next(): void;
  prev(): void;
};

export function registerShortcuts(h: Handlers): void {
  const bindings: [string, () => void][] = [
    ['CommandOrControl+Shift+T', h.toggleAlwaysOnTop],
    ['CommandOrControl+Shift+Space', h.togglePause],
    ['CommandOrControl+Shift+Right', h.next],
    ['CommandOrControl+Shift+Left', h.prev],
  ];
  // register() returns false when another app already owns the accelerator.
  for (const [accel, fn] of bindings) {
    if (!globalShortcut.register(accel, fn)) {
      console.warn('[prompter] shortcut not available (used by another app):', accel);
    }
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
