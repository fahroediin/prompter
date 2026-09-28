import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './settings';
import { BridgeServer } from './server';
import { createOverlayWindow, createControlWindow, applyWindowMode } from './windows';
import { registerShortcuts, unregisterShortcuts } from './shortcuts';
import { IPC } from '../shared/ipc';
import type { PromptSettings } from './settings';

let overlay: BrowserWindow | null = null;
let control: BrowserWindow | null = null;
let server: BridgeServer;
let store: Store;
let settings: PromptSettings;
let paused = false;

function overlaySend(channel: string, payload?: unknown) {
  overlay?.webContents.send(channel, payload);
}
function controlSend(channel: string, payload?: unknown) {
  control?.webContents.send(channel, payload);
}

function setPaused(next: boolean) {
  paused = next;
  // Pause source of truth: setPaused persists to the server (so late/
  // reconnecting listener clients get the right state) and broadcasts to
  // connected listener pages, then fans out to both renderer windows.
  server.setPaused(paused);
  server.sendState();
  overlaySend(IPC.paused, paused);
  controlSend(IPC.paused, paused);
}

// R15: forward renderer problems to stdout for debugging.
function wireDiagnostics(win: BrowserWindow, label: string) {
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // Electron's ConsoleMessageLevel: 0=verbose/log, 1=info, 2=warning, 3=error.
    if (level >= 2) {
      console.log(`[prompter] [${label}] console:`, level, message, `${sourceId}:${line}`);
    }
  });
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.log(`[prompter] [${label}] did-fail-load:`, errorCode, errorDescription, validatedURL);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[prompter] [${label}] render-process-gone:`, details);
  });
}

async function boot() {
  store = new Store(app.getPath('userData'));
  settings = store.readSettings();

  const dist = __dirname; // dist/main
  const root = join(dist, '..', '..'); // project root
  const publicDir = join(root, 'public');

  server = new BridgeServer({ publicDir });
  await server.start();
  // Smoke-test evidence: log the listener URL once at startup.
  console.log('[prompter] listener:', server.url);

  server.onTranscript((m) => {
    if (!paused) overlaySend(IPC.transcript, m);
  });
  server.onClientCount((n) => {
    overlaySend(IPC.status, { type: 'status', code: n > 0 ? 'ok' : 'listener-offline' });
  });
  // R3 (spec §6): forward listener-page errors to the overlay as status.
  server.onListenerError((m) => {
    overlaySend(IPC.status, { type: 'status', code: m.code });
  });

  overlay = createOverlayWindow(
    join(dist, '..', 'preload', 'overlay-preload.js'),
    join(dist, '..', 'renderer', 'overlay', 'overlay.html')
  );
  control = createControlWindow(
    join(dist, '..', 'preload', 'control-preload.js'),
    join(dist, '..', 'renderer', 'control', 'control.html')
  );

  wireDiagnostics(overlay, 'overlay');
  wireDiagnostics(control, 'control');

  overlay.webContents.on('did-finish-load', () => {
    applyWindowMode(overlay!, settings);
    overlaySend(IPC.settings, settings);
    overlaySend(IPC.setScript, store.readScript());
    overlaySend(IPC.paused, paused);
  });
  control.webContents.on('did-finish-load', () => {
    controlSend(IPC.settings, settings);
    controlSend(IPC.setScript, store.readScript());
  });

  registerShortcuts({
    toggleAlwaysOnTop: () => {
      settings = { ...settings, alwaysOnTop: !settings.alwaysOnTop };
      store.writeSettings(settings);
      applyWindowMode(overlay!, settings);
      controlSend(IPC.settings, settings);
    },
    togglePause: () => setPaused(!paused),
    next: () => overlaySend(IPC.manualNext),
    prev: () => overlaySend(IPC.manualPrev),
  });

  ipcMain.on(IPC.togglePause, () => setPaused(!paused));
  ipcMain.on(IPC.applySettings, (_e, s: PromptSettings) => {
    settings = s;
    store.writeSettings(settings);
    applyWindowMode(overlay!, settings);
    overlaySend(IPC.settings, settings);
    controlSend(IPC.settings, settings);
  });
  ipcMain.on(IPC.setScript, (_e, text: string) => {
    store.writeScript(text);
    overlaySend(IPC.setScript, text);
  });
  ipcMain.on(IPC.openListener, () => shell.openExternal(server.url));
  ipcMain.handle(IPC.loadScriptFile, async () => {
    const r = await dialog.showOpenDialog(control!, {
      filters: [{ name: 'Naskah', extensions: ['txt', 'md'] }],
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return '';
    return readFileSync(r.filePaths[0], 'utf8');
  });
  // R7 (spec AC-05.01): suspend click-through while the pointer is over the
  // overlay's own controls (e.g. the Pause button), so they stay clickable.
  ipcMain.on(IPC.mouseOverControls, (_e: unknown, over: boolean) => {
    if (!overlay) return;
    if (settings.clickThrough) {
      overlay.setIgnoreMouseEvents(!over, { forward: true });
    }
  });
}

app.whenReady().then(boot);
app.on('will-quit', () => {
  unregisterShortcuts();
  server?.stop();
});
app.on('window-all-closed', () => app.quit());
