export const IPC = {
  transcript: 'transcript',           // main -> overlay: TranscriptMsg
  status: 'status',                   // main -> overlay: StatusMsg
  paused: 'paused',                   // main -> overlay: boolean
  settings: 'settings',               // main <-> both: PromptSettings
  position: 'position',               // overlay -> main: number (for status only)
  setScript: 'set-script',            // control -> main -> overlay: string
  manualNext: 'manual-next',          // main -> overlay
  manualPrev: 'manual-prev',          // main -> overlay
  togglePause: 'toggle-pause',        // overlay/control -> main
  openListener: 'open-listener',      // control -> main
  applySettings: 'apply-settings',    // control -> main (persist + fan out)
  loadScriptFile: 'load-script-file', // control -> main (dialog) -> returns string
  mouseOverControls: 'mouse-over-controls', // overlay -> main: boolean
} as const;
