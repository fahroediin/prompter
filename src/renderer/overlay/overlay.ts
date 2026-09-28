import { Tracker } from '../../core/tracker';
import { ScriptView } from './script-view';
import { AutoScroller } from './auto-scroller';
import { lastSentenceRange } from './sentence-range';
import { carryPosition } from './carry-position';
import { progressLabel } from './progress';
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
const badgeEl = document.querySelector('.badge') as HTMLElement | null;
const seekEl = document.getElementById('seek') as HTMLInputElement | null;
const progressEl = document.getElementById('progress') as HTMLElement | null;

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

// Mark words, update the progress footer and tell main. scroll: false when
// the text is already where the user (or the fallback scroller) put it.
function render(opts: { scroll?: boolean } = {}) {
  const pos = tracker.position;
  view.setPosition(pos, { scroll: opts.scroll, instant: scroller.running });
  if (seekEl) {
    seekEl.max = String(tracker.tokens.length);
    seekEl.value = String(pos);
  }
  if (progressEl) progressEl.textContent = progressLabel(pos, tracker.tokens.length);
  window.prompter.sendPosition(pos);
  if (paused) applyPauseHighlight();
}

function applyPauseHighlight() {
  // R6 (AC-05.04): highlight the last sentence (containing position - 1).
  const range = lastSentenceRange(tracker.sentenceStarts, tracker.position, tracker.tokens.length);
  view.setHighlight(range);
}

// Adopt the word on the reading line as the position (after a manual scroll,
// and continuously while the fallback scroller moves the text).
function syncFromScroll() {
  const pos = view.positionAtReadingLine(tracker.position);
  if (pos === tracker.position) return;
  tracker.setPosition(pos);
  render({ scroll: false });
}

// The fallback scroller moves pixels, so poll the reading line to keep the
// position (dimming, progress, prev/next) in step with what is on screen.
let fallbackSync: ReturnType<typeof setInterval> | undefined;
function startScroller() {
  scroller.start(autoSpeed);
  clearInterval(fallbackSync);
  fallbackSync = setInterval(syncFromScroll, 250);
}
function stopScroller() {
  scroller.stop();
  clearInterval(fallbackSync);
  fallbackSync = undefined;
}

function moveTo(step: () => void) {
  if (scroller.running) syncFromScroll();
  step();
  render();
}

const goPrev = () => moveTo(() => tracker.prevSentence());
const goNext = () => moveTo(() => tracker.nextSentence());

window.prompter.onScript((text) => {
  // R16: carry the current position into the new Tracker instead of
  // resetting to 0 on every edit — otherwise Tracker.feed's pos-5..pos+40
  // search window loses the speaker's place on every keystroke.
  const oldPos = tracker.position;
  const next = new Tracker(text);
  next.setPosition(carryPosition(oldPos, next.tokens.length));
  tracker = next;
  view.setScript(tracker.tokens);
  render();
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
  if (badgeEl) badgeEl.textContent = p ? 'PAUSED' : 'AKTIF';

  if (p) {
    // R13: freeze position, stop any running fallback scroller.
    stopScroller();
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
    if (fallbackActive) startScroller();
  }
});

window.prompter.onTranscript((m) => {
  if (paused) return;
  if (scroller.running) {
    stopScroller(); // speech resumed -> leave fallback
    fallbackActive = false;
  }
  tracker.feed(m.text, m.isFinal);
  render();
  setStatus(tracker.status === 'lost' ? LOST_STATUS : '');
});

window.prompter.onStatus((m) => {
  if (m.code === 'listener-offline') {
    setStatus('Listener offline');
    fallbackActive = true;
    if (!paused) startScroller();
  } else if (m.code === 'network') {
    // R3 (spec §6): network error from the listener page.
    setStatus('Jaringan error');
    fallbackActive = true;
    if (!paused) startScroller();
  } else if (m.code === 'mic-denied') {
    // R3 (spec §6): microphone permission denied in the listener browser.
    setStatus('Mikrofon ditolak — izinkan akses mikrofon di browser');
  } else {
    setStatus('');
    fallbackActive = false;
    if (scroller.running) stopScroller();
  }
});

window.prompter.onManualNext(goNext);
window.prompter.onManualPrev(goPrev);

pauseBtn?.addEventListener('click', () => window.prompter.togglePause());
document.getElementById('prevBtn')?.addEventListener('click', goPrev);
document.getElementById('nextBtn')?.addEventListener('click', goNext);

// Clicking a word makes it the current position.
viewEl.addEventListener('click', (e) => {
  const span = (e.target as HTMLElement).closest<HTMLElement>('span[data-i]');
  if (!span) return;
  moveTo(() => tracker.setPosition(Number(span.dataset.i)));
});

// Dragging the progress slider seeks anywhere in the script.
seekEl?.addEventListener('input', () => {
  tracker.setPosition(Number(seekEl.value));
  render();
});

// Wheel scrolling moves the text natively; once it settles, adopt the word on
// the reading line as the position so voice-follow continues from there.
let wheelTimer: ReturnType<typeof setTimeout> | undefined;
viewEl.addEventListener(
  'wheel',
  () => {
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(syncFromScroll, 200);
  },
  { passive: true }
);

// Keys while the overlay has focus (global Ctrl+Shift shortcuts work anytime).
window.addEventListener('keydown', (e) => {
  if (e.target === seekEl) return; // the slider handles its own arrow keys
  if (e.target instanceof HTMLButtonElement) return; // Space already clicks it
  if (e.key === 'ArrowLeft') goPrev();
  else if (e.key === 'ArrowRight') goNext();
  else if (e.key === 'Home') moveTo(() => tracker.setPosition(0));
  else if (e.key === ' ') window.prompter.togglePause();
  else return;
  e.preventDefault();
});

// R7 (spec AC-05.01): let main know when the pointer is over the bar or the
// footer so click-through can be suspended for just those areas.
document.querySelectorAll<HTMLElement>('.controls').forEach((el) => {
  el.addEventListener('mouseenter', () => window.prompter.setMouseOverControls(true));
  el.addEventListener('mouseleave', () => window.prompter.setMouseOverControls(false));
});
