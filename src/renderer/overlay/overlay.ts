import { Tracker } from '../../core/tracker';
import { ScriptView } from './script-view';
import { AutoScroller } from './auto-scroller';
import { lastSentenceRange } from './sentence-range';
import type { TranscriptMsg, StatusMsg } from '../../shared/messages';
import type { PromptSettings } from '../../main/settings';

declare global {
  interface Window {
    prompter: {
      onTranscript(cb: (m: TranscriptMsg) => void): void;
      onStatus(cb: (m: StatusMsg) => void): void;
      onPaused(cb: (p: boolean) => void): void;
      onSettings(cb: (s: PromptSettings) => void): void;
      onScript(cb: (t: string) => void): void;
      onManualNext(cb: () => void): void;
      onManualPrev(cb: () => void): void;
      togglePause(): void;
      sendPosition(n: number): void;
      setMouseOverControls(over: boolean): void;
    };
  }
}

const root = document.body;
const view = new ScriptView(root);
const viewEl = document.getElementById('view') as HTMLElement;
const scroller = new AutoScroller(viewEl);
const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement | null;
const controlsEl = document.querySelector('.controls') as HTMLElement | null;

let tracker = new Tracker('');
let paused = false;
let autoSpeed = 40;
// R13: track whether the AutoScroller fallback was active (listener offline
// or network error) so continue only restarts it if it was running before
// the pause, rather than always restarting.
let fallbackActive = false;

function refresh() {
  view.setPosition(tracker.position);
  window.prompter.sendPosition(tracker.position);
}

window.prompter.onScript((text) => {
  tracker = new Tracker(text);
  view.setScript(tracker.tokens);
  refresh();
});

window.prompter.onSettings((s) => {
  autoSpeed = s.autoScrollSpeed;
  view.applySettings(s);
});

window.prompter.onPaused((p) => {
  paused = p;
  view.setPaused(p);
  if (pauseBtn) pauseBtn.textContent = p ? 'Lanjut' : 'Jeda';

  if (p) {
    // R13: freeze position, stop any running fallback scroller.
    scroller.stop();
    // R6 (AC-05.04): highlight the last sentence (containing position - 1).
    const range = lastSentenceRange(tracker.sentenceStarts, tracker.position, tracker.tokens.length);
    view.setHighlight(range);
  } else {
    view.setHighlight(null);
    // R13: only restart the fallback scroller if it was active before pause.
    if (fallbackActive) scroller.start(autoSpeed);
  }
});

window.prompter.onTranscript((m) => {
  if (paused) return;
  if (scroller.running) {
    scroller.stop(); // speech resumed -> leave fallback
    fallbackActive = false;
  }
  tracker.feed(m.text, m.isFinal);
  refresh();
  // R14: while paused, don't show the "lost" status. (paused is false here,
  // but guard kept for clarity/defensiveness if ordering ever changes.)
  if (!paused) {
    view.setStatus(tracker.status === 'lost' ? 'Posisi tidak ditemukan' : '');
  }
});

window.prompter.onStatus((m) => {
  if (m.code === 'listener-offline') {
    view.setStatus('Listener offline');
    fallbackActive = true;
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'network') {
    // R3 (spec §6): network error from the listener page.
    view.setStatus('Jaringan error');
    fallbackActive = true;
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'mic-denied') {
    // R3 (spec §6): microphone permission denied in the listener browser.
    view.setStatus('Mikrofon ditolak — izinkan akses mikrofon di browser');
  } else {
    view.setStatus('');
    fallbackActive = false;
    if (scroller.running) scroller.stop();
  }
});

window.prompter.onManualNext(() => {
  tracker.nextSentence();
  refresh();
});
window.prompter.onManualPrev(() => {
  tracker.prevSentence();
  refresh();
});

pauseBtn?.addEventListener('click', () => window.prompter.togglePause());

// R7 (spec AC-05.01): let main know when the pointer is over the controls so
// click-through can be suspended for just that area.
controlsEl?.addEventListener('mouseenter', () => window.prompter.setMouseOverControls(true));
controlsEl?.addEventListener('mouseleave', () => window.prompter.setMouseOverControls(false));
