import { Tracker } from '../../core/tracker';
import { ScriptView } from './script-view';
import { AutoScroller } from './auto-scroller';
import { lastSentenceRange } from './sentence-range';
import { carryPosition } from './carry-position';
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

const LOST_STATUS = 'Posisi tidak ditemukan';

let tracker = new Tracker('');
let paused = false;
let autoSpeed = 40;
// R13: track whether the AutoScroller fallback was active (listener offline
// or network error) so continue only restarts it if it was running before
// the pause, rather than always restarting.
let fallbackActive = false;
// The status text currently shown, so onPaused(true) can clear it only when
// it's the "lost" status (R14 fix) without touching offline/network/mic text.
let currentStatus = '';

function setStatus(text: string) {
  currentStatus = text;
  view.setStatus(text);
}

function refresh() {
  view.setPosition(tracker.position);
  window.prompter.sendPosition(tracker.position);
}

function applyPauseHighlight() {
  // R6 (AC-05.04): highlight the last sentence (containing position - 1).
  const range = lastSentenceRange(tracker.sentenceStarts, tracker.position, tracker.tokens.length);
  view.setHighlight(range);
}

window.prompter.onScript((text) => {
  // R16: carry the current position into the new Tracker instead of
  // resetting to 0 on every edit — otherwise Tracker.feed's pos-5..pos+40
  // search window loses the speaker's place on every keystroke.
  const oldPos = tracker.position;
  const next = new Tracker(text);
  next.setPosition(carryPosition(oldPos, next.tokens.length));
  tracker = next;
  view.setScript(tracker.tokens);
  refresh();
  if (paused) applyPauseHighlight();
});

window.prompter.onSettings((s) => {
  autoSpeed = s.autoScrollSpeed;
  view.applySettings(s);
  // R17: live-update a running fallback scroller's speed, not just the
  // stored autoSpeed used the next time it starts.
  if (scroller.running) scroller.setSpeed(s.autoScrollSpeed);
});

window.prompter.onPaused((p) => {
  paused = p;
  view.setPaused(p);
  if (pauseBtn) pauseBtn.textContent = p ? 'Lanjut' : 'Jeda';

  if (p) {
    // R13: freeze position, stop any running fallback scroller.
    scroller.stop();
    applyPauseHighlight();
    // R14: clear a stale "lost" status on pause (only that one — offline/
    // network/mic statuses stay visible since they reflect real conditions).
    if (currentStatus === LOST_STATUS) setStatus('');
  } else {
    view.setHighlight(null);
    // R14: refresh lastMatchAt so a >10s-old timestamp doesn't immediately
    // report 'lost' right after resuming.
    tracker.setPosition(tracker.position);
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
    setStatus(tracker.status === 'lost' ? LOST_STATUS : '');
  }
});

window.prompter.onStatus((m) => {
  if (m.code === 'listener-offline') {
    setStatus('Listener offline');
    fallbackActive = true;
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'network') {
    // R3 (spec §6): network error from the listener page.
    setStatus('Jaringan error');
    fallbackActive = true;
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'mic-denied') {
    // R3 (spec §6): microphone permission denied in the listener browser.
    setStatus('Mikrofon ditolak — izinkan akses mikrofon di browser');
  } else {
    setStatus('');
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
