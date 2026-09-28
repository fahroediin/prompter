import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PromptSettings } from '../main/settings';

contextBridge.exposeInMainWorld('control', {
  onSettings: (cb: (s: PromptSettings) => void) =>
    ipcRenderer.on(IPC.settings, (_e, s) => cb(s)),
  onScript: (cb: (t: string) => void) => ipcRenderer.on(IPC.setScript, (_e, t) => cb(t)),
  applySettings: (s: PromptSettings) => ipcRenderer.send(IPC.applySettings, s),
  setScript: (text: string) => ipcRenderer.send(IPC.setScript, text),
  openListener: () => ipcRenderer.send(IPC.openListener),
  loadScriptFile: (): Promise<string> => ipcRenderer.invoke(IPC.loadScriptFile),
});
