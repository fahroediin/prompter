import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { TranscriptMsg, StatusMsg } from '../shared/messages';
import type { PromptSettings } from '../main/settings';

contextBridge.exposeInMainWorld('prompter', {
  onTranscript: (cb: (m: TranscriptMsg) => void) =>
    ipcRenderer.on(IPC.transcript, (_e, m) => cb(m)),
  onStatus: (cb: (m: StatusMsg) => void) => ipcRenderer.on(IPC.status, (_e, m) => cb(m)),
  onPaused: (cb: (p: boolean) => void) => ipcRenderer.on(IPC.paused, (_e, p) => cb(p)),
  onSettings: (cb: (s: PromptSettings) => void) =>
    ipcRenderer.on(IPC.settings, (_e, s) => cb(s)),
  onScript: (cb: (t: string) => void) => ipcRenderer.on(IPC.setScript, (_e, t) => cb(t)),
  onManualNext: (cb: () => void) => ipcRenderer.on(IPC.manualNext, () => cb()),
  onManualPrev: (cb: () => void) => ipcRenderer.on(IPC.manualPrev, () => cb()),
  togglePause: () => ipcRenderer.send(IPC.togglePause),
  sendPosition: (n: number) => ipcRenderer.send(IPC.position, n),
  setMouseOverControls: (over: boolean) => ipcRenderer.send(IPC.mouseOverControls, over),
});
