# Prompter Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop teleprompter overlay that stays on top, is hidden from screen share, and auto-scrolls a mixed Indonesian/English script by following the presenter's voice.

**Architecture:** Electron app with a privileged `main` process (owns overlay + control windows, global shortcuts, settings persistence, and a local HTTP+WebSocket server) and a renderer that runs a pure `Tracker` for voice alignment plus a `ScriptView` for rendering. Speech recognition runs *outside* Electron in a real Edge/Chrome tab (served `listener.html` from the local server) because Electron's bundled Chromium has no Google Speech API key; transcripts flow tab → WebSocket → main → IPC → renderer → `Tracker`.

**Tech Stack:** Electron, TypeScript, Vitest (unit + integration), `ws` (WebSocket server), Node `http` (static serving), Web Speech API (`webkitSpeechRecognition`) in the external browser tab.

**Spec:** `docs/superpowers/specs/2026-09-28-prompter-overlay-design.md`

## Global Constraints

- Target OS: **Windows 11 only** (v1). No macOS/Linux support required.
- Project root: `C:\Users\User\Documents\Github_Fahrudin\SERVICES\prompter` (the repo). All paths below are relative to this root. (Spec text says `Github_Fahrudin/prompter/`; the real checkout is `SERVICES/prompter` — use the repo root.)
- Language: **TypeScript** throughout. Test runner: **Vitest**.
- Local server binds **127.0.0.1** only, starting at port **47821**, incrementing to **47830** if taken. Never bind a public interface.
- Speech recognition language: **`id-ID`**, `continuous: true`, `interimResults: true`, with auto-restart on `onend` **unless** stopped.
- Overlay window: frameless, transparent, `setContentProtection(true)` (always on, even when always-on-top is off), `setAlwaysOnTop(true, 'screen-saver')` when the always-on-top setting is on else `setAlwaysOnTop(false)` + `setSkipTaskbar` toggled to match, `setIgnoreMouseEvents(true, { forward: true })` when click-through is on.
- **Pause is the single source of truth in main.** When paused, the microphone must never be sent to STT — auto-restart and reconnect must both respect paused state (AC-05.03, AC-05.06).
- Global shortcuts: `Ctrl+Shift+T` toggle always-on-top, `Ctrl+Shift+Space` toggle pause, plus next/prev-sentence shortcuts (AC-06.01).
- Default always-on-top: **on**.
- All UI copy is Bahasa Indonesia (match the spec's tone), matching existing spec wording where a label already exists.
- Settings + last script persist as JSON in Electron `userData` and are restored on launch.

---

## File Structure

Source lives under `src/`, split by process boundary and responsibility:

- `src/shared/messages.ts` — WebSocket/IPC message type definitions (shared by main, renderer, listener).
- `src/core/normalize.ts` — pure text → token normalization (no deps).
- `src/core/tracker.ts` — pure voice-follow alignment (`Tracker`), depends only on `normalize`.
- `src/main/settings.ts` — settings + last-script persistence (fs / Electron `userData`).
- `src/main/server.ts` — local HTTP static server + WebSocket bridge; enforces paused state.
- `src/main/windows.ts` — overlay + control `BrowserWindow` creation and window-mode application.
- `src/main/shortcuts.ts` — global shortcut registration → intents.
- `src/main/index.ts` — main entry: wires settings, server, windows, shortcuts, pause state, IPC.
- `src/preload/overlay-preload.ts` — contextBridge API for the overlay renderer.
- `src/preload/control-preload.ts` — contextBridge API for the control renderer.
- `src/renderer/overlay/script-view.ts` — `ScriptView` DOM rendering, dimming, smooth scroll, PAUSED + status.
- `src/renderer/overlay/auto-scroller.ts` — `AutoScroller` fixed-speed fallback.
- `src/renderer/overlay/overlay.ts` — overlay renderer entry: Tracker + ScriptView + IPC glue.
- `src/renderer/overlay/overlay.html` — overlay markup.
- `src/renderer/control/control.ts` + `control.html` — control window UI (script editor, settings, open-listener).
- `public/listener.html` — external-browser Web Speech listener page (served by the server).

Tests mirror source under `tests/`:
- `tests/core/normalize.test.ts`, `tests/core/tracker.test.ts`
- `tests/main/settings.test.ts`, `tests/main/server.test.ts` (integration, fake WS client)

Config: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, Electron entry wiring.

---

### Task 1: Project scaffold & toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/shared/messages.ts`
- Test: `tests/core/smoke.test.ts` (temporary sanity test)

**Interfaces:**
- Consumes: nothing.
- Produces: the `Msg` union types used by every later task:
  - `TranscriptMsg = { type: 'transcript'; text: string; isFinal: boolean }`
  - `ControlMsg = { type: 'start' } | { type: 'stop' }`
  - `StatusMsg = { type: 'status'; code: StatusCode; detail?: string }`
  - `StatusCode = 'listener-offline' | 'mic-denied' | 'network' | 'lost' | 'ok'`
  - `type ServerToClient = ControlMsg | StatusMsg`, `type ClientToServer = TranscriptMsg`

- [ ] **Step 1: Write the failing smoke test**

```typescript
// tests/core/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs typescript + vitest', () => {
    const x: number = 1 + 1;
    expect(x).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails (no runner yet)**

Run: `npx vitest run`
Expected: FAIL — vitest not installed / no config.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "prompter",
  "version": "0.1.0",
  "private": true,
  "description": "Voice-following teleprompter overlay for Windows",
  "main": "dist/main/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "npm run build && electron .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.10",
    "electron": "^33.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 6: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.log
```

- [ ] **Step 7: Create `src/shared/messages.ts`**

```typescript
export type TranscriptMsg = { type: 'transcript'; text: string; isFinal: boolean };
export type ControlMsg = { type: 'start' } | { type: 'stop' };
export type StatusCode = 'listener-offline' | 'mic-denied' | 'network' | 'lost' | 'ok';
export type StatusMsg = { type: 'status'; code: StatusCode; detail?: string };

export type ServerToClient = ControlMsg | StatusMsg;
export type ClientToServer = TranscriptMsg;
```

- [ ] **Step 8: Install deps and run the smoke test**

Run: `npm install && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/shared/messages.ts tests/core/smoke.test.ts
git commit -m "chore: scaffold electron + typescript + vitest project"
```

---

### Task 2: `normalize` — text to tokens

**Files:**
- Create: `src/core/normalize.ts`
- Test: `tests/core/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Token = { raw: string; norm: string; phon: string }`
  - `function normalize(text: string): Token[]`
  - `function phonetic(word: string): string` (exported for reuse/testing)

Phonetic rules (spec §4): lowercase, strip punctuation; then on the lowercased word apply — `ph→f`, `c→k` (but `c` before `e`/`i`/`y` → `s`), `y→i`, `ee→i`, `oo→u`, collapse doubled consonants to single, drop a trailing `h`. Empty tokens (pure punctuation) are dropped.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalize, phonetic } from '../../src/core/normalize';

describe('phonetic', () => {
  it('maps ph to f', () => expect(phonetic('phone')).toBe('fon'));
  it('maps ee to i and oo to u', () => {
    expect(phonetic('meeting')).toBe('miting');
    expect(phonetic('food')).toBe('fud');
  });
  it('c before e/i/y becomes s, else k', () => {
    expect(phonetic('city')).toBe('siti');
    expect(phonetic('cat')).toBe('kat');
  });
  it('y becomes i', () => expect(phonetic('yes')).toBe('ies'));
  it('collapses doubled consonants', () => expect(phonetic('happy')).toBe('hapi'));
  it('drops trailing h', () => expect(phonetic('rumah')).toBe('ruma'));
});

describe('normalize', () => {
  it('lowercases, strips punctuation, drops empties', () => {
    const toks = normalize('Hello, World!');
    expect(toks.map((t) => t.raw)).toEqual(['Hello', 'World']);
    expect(toks.map((t) => t.norm)).toEqual(['hello', 'world']);
  });
  it('produces phon key per token', () => {
    const toks = normalize('Phone city');
    expect(toks.map((t) => t.phon)).toEqual(['fon', 'siti']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/normalize.ts`**

```typescript
export type Token = { raw: string; norm: string; phon: string };

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

export function phonetic(word: string): string {
  let w = word.toLowerCase();
  w = w.replace(/ph/g, 'f');
  // c -> s before e/i/y, else k
  w = w.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
  w = w.replace(/y/g, 'i');
  w = w.replace(/ee/g, 'i').replace(/oo/g, 'u');
  // collapse doubled consonants (not vowels)
  w = w.replace(/([^aeiou])\1+/g, '$1');
  // drop trailing h
  w = w.replace(/h$/, '');
  return w;
}

export function normalize(text: string): Token[] {
  const out: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    const stripped = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (!stripped) continue;
    const norm = stripped.toLowerCase();
    out.push({ raw: stripped, norm, phon: phonetic(norm) });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/normalize.ts tests/core/normalize.test.ts
git commit -m "feat: normalize text into raw/norm/phon tokens"
```

---

### Task 3: `Tracker` — voice-follow alignment

**Files:**
- Create: `src/core/tracker.ts`
- Test: `tests/core/tracker.test.ts`

**Interfaces:**
- Consumes: `normalize`, `Token` from `src/core/normalize.ts`.
- Produces:
  - `class Tracker`
    - `constructor(scriptText: string, now?: () => number)`
    - `feed(text: string, isFinal: boolean): number` — returns the new position (index into script tokens, = number of tokens consumed), or the unchanged current position.
    - `get position(): number`
    - `setPosition(pos: number): void`
    - `nextSentence(): number` / `prevSentence(): number` — move to the token index at the start of the next/previous sentence; return new position.
    - `get status(): 'ok' | 'lost'` — `lost` when no match for > 10s (uses injected `now`).
    - `get tokens(): readonly Token[]` — script tokens (for the view).
    - `get sentenceStarts(): readonly number[]` — token indices where each sentence begins.

Algorithm (spec §4): take last N transcript tokens (N=6 interim, whole phrase for final, cap 12); candidate window `pos-5 .. pos+40`; for each candidate end `j`, local alignment score (exact=2, phonetic=1.5, edit-distance-small=1, else −1; gap=−0.5); accept best `j` if score ≥ 3 and ≥ 2 tokens matched; ties → `j` nearest current pos. Interim may only advance; final may retreat ≤ 5 tokens. No match > 10s → `lost`.

"edit-distance-small": Levenshtein ≤ 1 for words ≤ 5 chars, ≤ 2 for longer.

Sentence boundaries: split the *original* script on `.`, `!`, `?`, or newline; `sentenceStarts` are the token indices beginning each non-empty sentence (used by next/prev-sentence and to compute retreat/repeat behavior).

- [ ] **Step 1: Write the failing tests (cover AC-04.03–06, pause=no feed, manual moves)**

```typescript
// tests/core/tracker.test.ts
import { describe, it, expect } from 'vitest';
import { Tracker } from '../../src/core/tracker';

const SCRIPT =
  'Selamat pagi semua. Hari ini kita membahas produk baru. ' +
  'Fitur utama adalah kecepatan. Terima kasih banyak.';

describe('Tracker basic follow', () => {
  it('advances position as the transcript matches the script', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua', true);
    expect(t.position).toBeGreaterThanOrEqual(3);
  });

  it('AC-04.04: speech not in the script does not move position', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua', true);
    const p = t.position;
    t.feed('apa kabar teman-teman semuanya', true);
    expect(t.position).toBe(p);
  });

  it('AC-04.03: a skipped/misheard word still tracks', () => {
    const t = new Tracker(SCRIPT);
    // "hari ini kita membahas" spoken as "hari kita bahas produk" (skip + mishear)
    t.feed('selamat pagi semua hari kita bahas produk', true);
    expect(t.position).toBeGreaterThanOrEqual(7);
  });

  it('AC-04.03: English word written phonetically still matches', () => {
    const t = new Tracker('Kita pakai meeting hari ini');
    t.feed('kita pakai miting', true); // "meeting" -> "miting"
    expect(t.position).toBeGreaterThanOrEqual(3);
  });

  it('interim only advances, never retreats', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua hari ini kita membahas', true);
    const p = t.position;
    t.feed('selamat pagi', false); // interim pointing backwards
    expect(t.position).toBe(p);
  });

  it('AC-04.05: repeating the last sentence is still followed', () => {
    const t = new Tracker(SCRIPT);
    t.feed('selamat pagi semua hari ini kita membahas produk baru', true);
    const p = t.position;
    // repeat previous sentence as a final -> allowed small retreat
    t.feed('hari ini kita membahas produk baru', true);
    expect(t.position).toBeLessThanOrEqual(p);
    expect(t.position).toBeGreaterThan(0);
  });

  it('AC-04.06: duplicate phrase does not jump to a far occurrence', () => {
    const dup = 'terima kasih semua. lalu kita mulai. terima kasih semua lagi.';
    const t = new Tracker(dup);
    t.feed('terima kasih semua', true); // matches the near (first) occurrence
    expect(t.position).toBeLessThanOrEqual(4);
  });
});

describe('Tracker manual + pause + status', () => {
  it('nextSentence / prevSentence move by sentence', () => {
    const t = new Tracker(SCRIPT);
    const s1 = t.nextSentence();
    expect(s1).toBeGreaterThan(0);
    const back = t.prevSentence();
    expect(back).toBe(0);
  });

  it('setPosition sets an explicit position', () => {
    const t = new Tracker(SCRIPT);
    t.setPosition(5);
    expect(t.position).toBe(5);
  });

  it('no feed leaves position unchanged (pause)', () => {
    const t = new Tracker(SCRIPT);
    t.setPosition(4);
    expect(t.position).toBe(4);
  });

  it('status becomes lost after 10s without a match', () => {
    let clock = 1000;
    const t = new Tracker(SCRIPT, () => clock);
    t.feed('selamat pagi semua', true);
    expect(t.status).toBe('ok');
    clock += 11000;
    t.feed('xyz qwe rty', true); // no match
    expect(t.status).toBe('lost');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/core/tracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/tracker.ts`**

```typescript
import { normalize, Token } from './normalize';

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = tmp;
      if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > cap) return cap + 1;
  }
  return prev[b.length];
}

function editCap(word: string): number {
  return word.length <= 5 ? 1 : 2;
}

// Word-pair score: exact=2, phonetic=1.5, small-edit=1, else -1.
function pairScore(s: Token, h: Token): number {
  if (s.norm === h.norm) return 2;
  if (s.phon === h.phon) return 1.5;
  const cap = Math.max(editCap(s.norm), editCap(h.norm));
  if (levenshtein(s.norm, h.norm, cap) <= cap) return 1;
  return -1;
}

const GAP = -0.5;

// Local alignment (Smith-Waterman-like) of heard tokens against a script slice
// that ENDS at scriptEnd (exclusive). Returns {score, matched}.
function alignEndingAt(
  script: Token[],
  scriptEnd: number,
  heard: Token[]
): { score: number; matched: number } {
  const start = Math.max(0, scriptEnd - (heard.length + 6));
  const s = script.slice(start, scriptEnd);
  const m = s.length;
  const n = heard.length;
  // dp[i][j] = best local score of alignment ending at s[i-1],heard[j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const mt: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  let best = 0;
  let bestMatched = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const ps = pairScore(s[i - 1], heard[j - 1]);
      const diag = dp[i - 1][j - 1] + ps;
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;
      let v = Math.max(0, diag, up, left);
      dp[i][j] = v;
      if (v === diag && diag > 0) {
        mt[i][j] = mt[i - 1][j - 1] + (ps >= 1 ? 1 : 0);
      } else if (v === up) {
        mt[i][j] = mt[i - 1][j];
      } else if (v === left) {
        mt[i][j] = mt[i][j - 1];
      } else {
        mt[i][j] = 0;
      }
      if (v > best) {
        best = v;
        bestMatched = mt[i][j];
      }
    }
  }
  return { score: best, matched: bestMatched };
}

function heardTokens(text: string, isFinal: boolean): Token[] {
  const all = normalize(text);
  const n = isFinal ? Math.min(all.length, 12) : Math.min(all.length, 6);
  return all.slice(all.length - n);
}

export class Tracker {
  readonly tokens: Token[];
  readonly sentenceStarts: number[];
  private pos = 0;
  private lastMatchAt: number;
  private now: () => number;

  constructor(scriptText: string, now: () => number = () => Date.now()) {
    this.tokens = normalize(scriptText);
    this.sentenceStarts = Tracker.computeSentenceStarts(scriptText);
    this.now = now;
    this.lastMatchAt = now();
  }

  private static computeSentenceStarts(text: string): number[] {
    const starts: number[] = [];
    let count = 0;
    let atStart = true;
    for (const raw of text.split(/\s+/)) {
      const stripped = raw.replace(/[^\p{L}\p{N}]/gu, '');
      if (stripped) {
        if (atStart) {
          starts.push(count);
          atStart = false;
        }
        count++;
      }
      if (/[.!?\n]/.test(raw)) atStart = true;
    }
    if (starts.length === 0) starts.push(0);
    return starts;
  }

  get position(): number {
    return this.pos;
  }

  get status(): 'ok' | 'lost' {
    return this.now() - this.lastMatchAt > 10000 ? 'lost' : 'ok';
  }

  setPosition(pos: number): void {
    this.pos = Math.max(0, Math.min(pos, this.tokens.length));
    this.lastMatchAt = this.now();
  }

  feed(text: string, isFinal: boolean): number {
    const heard = heardTokens(text, isFinal);
    if (heard.length === 0) return this.pos;

    const lo = Math.max(0, this.pos - 5);
    const hi = Math.min(this.tokens.length, this.pos + 40);

    let bestEnd = -1;
    let bestScore = -Infinity;
    for (let j = lo + 1; j <= hi; j++) {
      const { score, matched } = alignEndingAt(this.tokens, j, heard);
      if (score < 3 || matched < 2) continue;
      // tie-break: prefer nearest to current pos
      const better =
        score > bestScore ||
        (score === bestScore &&
          Math.abs(j - this.pos) < Math.abs(bestEnd - this.pos));
      if (better) {
        bestScore = score;
        bestEnd = j;
      }
    }

    if (bestEnd < 0) {
      // no acceptable match; leave lastMatchAt so status can go 'lost'
      return this.pos;
    }

    // interim may only advance; final may retreat up to 5 tokens
    if (!isFinal && bestEnd < this.pos) {
      return this.pos;
    }
    if (isFinal && bestEnd < this.pos - 5) {
      bestEnd = this.pos; // ignore too-far retreat
    }

    this.pos = bestEnd;
    this.lastMatchAt = this.now();
    return this.pos;
  }

  nextSentence(): number {
    const next = this.sentenceStarts.find((s) => s > this.pos);
    this.setPosition(next ?? this.tokens.length);
    return this.pos;
  }

  prevSentence(): number {
    let target = 0;
    for (const s of this.sentenceStarts) {
      if (s < this.pos) target = s;
      else break;
    }
    // if already at a sentence start, go to the one before it
    if (target === this.pos) {
      const idx = this.sentenceStarts.indexOf(target);
      target = idx > 0 ? this.sentenceStarts[idx - 1] : 0;
    }
    this.setPosition(target);
    return this.pos;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/tracker.test.ts`
Expected: PASS. If a threshold test is borderline, tune only the accept threshold / window constants — do not weaken the AC-04.04 (no-move on off-script) or AC-04.06 (no far-jump) guarantees.

- [ ] **Step 5: Commit**

```bash
git add src/core/tracker.ts tests/core/tracker.test.ts
git commit -m "feat: voice-follow Tracker with phonetic + edit-distance alignment"
```

---

### Task 4: `Settings` — persistence

**Files:**
- Create: `src/main/settings.ts`
- Test: `tests/main/settings.test.ts`

**Interfaces:**
- Consumes: nothing (fs only; Electron `app.getPath('userData')` injected as a dir arg for testability).
- Produces:
  - `type PromptSettings = { alwaysOnTop: boolean; clickThrough: boolean; bgOpacity: number; fontWeight: number; fontSize: number; margin: number; autoScrollSpeed: number }`
  - `const DEFAULT_SETTINGS: PromptSettings` (alwaysOnTop=true, clickThrough=false, bgOpacity=40, fontWeight=600, fontSize=32, margin=48, autoScrollSpeed=40)
  - `class Store { constructor(dir: string); readSettings(): PromptSettings; writeSettings(s: PromptSettings): void; readScript(): string; writeScript(text: string): void }`
  - Stored files: `<dir>/settings.json`, `<dir>/script.txt`. Reads tolerate missing/corrupt files by returning defaults / empty string.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, DEFAULT_SETTINGS } from '../../src/main/settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prompter-'));
});

describe('Store', () => {
  it('returns defaults when nothing is saved', () => {
    const s = new Store(dir);
    expect(s.readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(s.readScript()).toBe('');
  });

  it('round-trips settings', () => {
    const s = new Store(dir);
    const next = { ...DEFAULT_SETTINGS, bgOpacity: 70, fontWeight: 800 };
    s.writeSettings(next);
    expect(new Store(dir).readSettings()).toEqual(next);
  });

  it('round-trips the script', () => {
    const s = new Store(dir);
    s.writeScript('Halo dunia');
    expect(new Store(dir).readScript()).toBe('Halo dunia');
  });

  it('tolerates corrupt settings json', () => {
    const s = new Store(dir);
    require('node:fs').writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(s.readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/settings.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type PromptSettings = {
  alwaysOnTop: boolean;
  clickThrough: boolean;
  bgOpacity: number;
  fontWeight: number;
  fontSize: number;
  margin: number;
  autoScrollSpeed: number;
};

export const DEFAULT_SETTINGS: PromptSettings = {
  alwaysOnTop: true,
  clickThrough: false,
  bgOpacity: 40,
  fontWeight: 600,
  fontSize: 32,
  margin: 48,
  autoScrollSpeed: 40,
};

export class Store {
  private settingsPath: string;
  private scriptPath: string;

  constructor(dir: string) {
    this.settingsPath = join(dir, 'settings.json');
    this.scriptPath = join(dir, 'script.txt');
  }

  readSettings(): PromptSettings {
    try {
      if (!existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  writeSettings(s: PromptSettings): void {
    writeFileSync(this.settingsPath, JSON.stringify(s, null, 2), 'utf8');
  }

  readScript(): string {
    try {
      return existsSync(this.scriptPath) ? readFileSync(this.scriptPath, 'utf8') : '';
    } catch {
      return '';
    }
  }

  writeScript(text: string): void {
    writeFileSync(this.scriptPath, text, 'utf8');
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/main/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.ts tests/main/settings.test.ts
git commit -m "feat: settings and last-script persistence store"
```

---

### Task 5: Local server — HTTP static + WebSocket bridge (pause-aware)

**Files:**
- Create: `src/main/server.ts`
- Create: `public/listener.html` (minimal now; full listener logic in Task 9 — but the file must exist to be served)
- Test: `tests/main/server.test.ts`

**Interfaces:**
- Consumes: `ServerToClient`, `ClientToServer` from `src/shared/messages.ts`.
- Produces:
  - `class BridgeServer`
    - `constructor(opts: { publicDir: string; startPort?: number; endPort?: number })`
    - `start(): Promise<number>` — resolves with the bound port (tries 47821..47830).
    - `stop(): Promise<void>`
    - `get url(): string` — `http://127.0.0.1:<port>/listener.html`
    - `broadcast(msg: ServerToClient): void`
    - `onTranscript(cb: (m: ClientToServer) => void): void`
    - `onClientCount(cb: (n: number) => void): void`
    - `sendState(): void` — sends current `start`/`stop` to a newly connected client. Server holds `setPaused(paused: boolean)`; on new connection it emits `stop` if paused else `start` (AC-05.06 reconnect safety).
  - Serves files from `publicDir` over HTTP (only `.html`), and a WS endpoint on the same port at path `/ws`.

- [ ] **Step 1: Create a placeholder `public/listener.html`**

```html
<!doctype html>
<html lang="id">
  <head><meta charset="utf-8" /><title>Prompter Listener</title></head>
  <body><p>Listener placeholder</p></body>
</html>
```

- [ ] **Step 2: Write the failing integration test (fake WS client)**

```typescript
// tests/main/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeServer } from '../../src/main/server';

function publicDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pub-'));
  writeFileSync(join(d, 'listener.html'), '<!doctype html><title>x</title>');
  return d;
}

let server: BridgeServer;
afterEach(async () => {
  await server?.stop();
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
function next(ws: WebSocket): Promise<any> {
  return new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))));
}

describe('BridgeServer', () => {
  it('serves listener.html over http', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/listener.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>');
  });

  it('relays transcript from client to onTranscript', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    const got: any[] = [];
    server.onTranscript((m) => got.push(m));
    const ws = await connect(`ws://127.0.0.1:${port}/ws`);
    ws.send(JSON.stringify({ type: 'transcript', text: 'halo', isFinal: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(got[0]).toEqual({ type: 'transcript', text: 'halo', isFinal: true });
    ws.close();
  });

  it('sends stop to a client that connects while paused (reconnect safety)', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    server.setPaused(true);
    const ws = await connect(`ws://127.0.0.1:${port}/ws`);
    const msg = await next(ws);
    expect(msg).toEqual({ type: 'stop' });
    ws.close();
  });

  it('sends start to a client that connects while running', async () => {
    server = new BridgeServer({ publicDir: publicDir() });
    const port = await server.start();
    server.setPaused(false);
    const ws = await connect(`ws://127.0.0.1:${port}/ws`);
    const msg = await next(ws);
    expect(msg).toEqual({ type: 'start' });
    ws.close();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/main/server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/main/server.ts`**

```typescript
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize as pathNormalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerToClient, ClientToServer } from '../shared/messages';

export class BridgeServer {
  private publicDir: string;
  private startPort: number;
  private endPort: number;
  private http?: Server;
  private wss?: WebSocketServer;
  private port = 0;
  private paused = false;
  private transcriptCbs: ((m: ClientToServer) => void)[] = [];
  private countCbs: ((n: number) => void)[] = [];

  constructor(opts: { publicDir: string; startPort?: number; endPort?: number }) {
    this.publicDir = opts.publicDir;
    this.startPort = opts.startPort ?? 47821;
    this.endPort = opts.endPort ?? 47830;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/listener.html`;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  onTranscript(cb: (m: ClientToServer) => void): void {
    this.transcriptCbs.push(cb);
  }
  onClientCount(cb: (n: number) => void): void {
    this.countCbs.push(cb);
  }

  broadcast(msg: ServerToClient): void {
    const data = JSON.stringify(msg);
    this.wss?.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = (req.url ?? '/').split('?')[0];
    const rel = pathNormalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const file = join(this.publicDir, rel === '/' ? 'listener.html' : rel);
    if (extname(file) !== '.html' || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(file));
  }

  private emitCount(): void {
    const n = this.wss?.clients.size ?? 0;
    this.countCbs.forEach((cb) => cb(n));
  }

  async start(): Promise<number> {
    for (let p = this.startPort; p <= this.endPort; p++) {
      try {
        await this.listenOn(p);
        this.port = p;
        return p;
      } catch (e: any) {
        if (e?.code !== 'EADDRINUSE') throw e;
      }
    }
    throw new Error(`no free port in ${this.startPort}..${this.endPort}`);
  }

  private listenOn(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => this.serveStatic(req, res));
      const wss = new WebSocketServer({ server: http, path: '/ws' });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify(this.paused ? { type: 'stop' } : { type: 'start' }));
        this.emitCount();
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as ClientToServer;
            if (msg?.type === 'transcript') this.transcriptCbs.forEach((cb) => cb(msg));
          } catch {
            /* ignore malformed */
          }
        });
        ws.on('close', () => this.emitCount());
      });
      http.on('error', reject);
      http.listen(port, '127.0.0.1', () => {
        this.http = http;
        this.wss = wss;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss?.close();
      if (this.http) this.http.close(() => resolve());
      else resolve();
    });
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/main/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/server.ts public/listener.html tests/main/server.test.ts
git commit -m "feat: local http+ws bridge server with pause-aware reconnect"
```

---

### Task 6: `ScriptView` — DOM rendering

**Files:**
- Create: `src/renderer/overlay/script-view.ts`
- Create: `src/renderer/overlay/overlay.html`
- Test: `tests/renderer/script-view.test.ts`

**Interfaces:**
- Consumes: `Token` from `src/core/normalize.ts`.
- Produces:
  - `class ScriptView`
    - `constructor(root: HTMLElement)`
    - `setScript(tokens: readonly Token[]): void` — renders one `<span data-i>` per token into a `.words` container.
    - `setPosition(pos: number): void` — adds `.read` to tokens `< pos`, `.active` to token `pos`; scrolls so the active token sits at ~1/3 from top (AC-04.01).
    - `setPaused(paused: boolean): void` — toggles a `PAUSED` badge + `.paused` class on root.
    - `setStatus(text: string): void` — writes into a small `.status` indicator (AC-06.03), empty string hides it.
    - `applySettings(s: { bgOpacity: number; fontWeight: number; fontSize: number; margin: number }): void` — sets CSS vars (AC-02.01–03).
  - Test uses Vitest `jsdom` environment (add `// @vitest-environment jsdom` at top of the test file).

Note: scroll math is exercised by asserting the CSS var / class state rather than real layout (jsdom has no layout). Assert `.active`/`.read` class placement and that `applySettings` sets the expected CSS custom properties.

- [ ] **Step 1: Create `src/renderer/overlay/overlay.html`**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Prompter</title>
    <style>
      :root { --bg-opacity: 0.4; --font-weight: 600; --font-size: 32px; --margin: 48px; }
      html, body { margin: 0; height: 100%; overflow: hidden; }
      body {
        background: rgba(0, 0, 0, var(--bg-opacity));
        color: #fff;
        font-family: system-ui, sans-serif;
        -webkit-app-region: drag;
      }
      #view { height: 100vh; overflow-y: auto; padding: 0 var(--margin); }
      .words { font-size: var(--font-size); font-weight: var(--font-weight); line-height: 1.6; }
      .words span { transition: opacity 120ms; }
      .words span.read { opacity: 0.35; }
      .words span.active { text-decoration: underline; }
      .badge { position: fixed; top: 8px; left: 8px; padding: 2px 8px; background: #b00; border-radius: 4px; display: none; -webkit-app-region: no-drag; }
      body.paused .badge { display: inline-block; }
      .status { position: fixed; bottom: 8px; left: 8px; font-size: 12px; opacity: 0.7; -webkit-app-region: no-drag; }
      .controls { position: fixed; bottom: 8px; right: 8px; -webkit-app-region: no-drag; }
    </style>
  </head>
  <body>
    <div class="badge">PAUSED</div>
    <div id="view"><div class="words"></div></div>
    <div class="status"></div>
    <div class="controls">
      <button id="pauseBtn">Pause</button>
    </div>
    <script src="./overlay.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test**

```typescript
// @vitest-environment jsdom
// tests/renderer/script-view.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ScriptView } from '../../src/renderer/overlay/script-view';
import { normalize } from '../../src/core/normalize';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML =
    '<div class="badge">PAUSED</div><div id="view"><div class="words"></div></div><div class="status"></div>';
  root = document.body;
});

describe('ScriptView', () => {
  it('renders one span per token', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    expect(root.querySelectorAll('.words span').length).toBe(3);
  });

  it('marks read + active by position', () => {
    const v = new ScriptView(root);
    v.setScript(normalize('halo dunia baru'));
    v.setPosition(2);
    const spans = root.querySelectorAll('.words span');
    expect(spans[0].classList.contains('read')).toBe(true);
    expect(spans[1].classList.contains('read')).toBe(true);
    expect(spans[2].classList.contains('active')).toBe(true);
  });

  it('toggles paused class', () => {
    const v = new ScriptView(root);
    v.setPaused(true);
    expect(root.classList.contains('paused')).toBe(true);
    v.setPaused(false);
    expect(root.classList.contains('paused')).toBe(false);
  });

  it('applySettings sets CSS variables', () => {
    const v = new ScriptView(root);
    v.applySettings({ bgOpacity: 70, fontWeight: 800, fontSize: 40, margin: 60 });
    expect(root.style.getPropertyValue('--bg-opacity')).toBe('0.7');
    expect(root.style.getPropertyValue('--font-weight')).toBe('800');
    expect(root.style.getPropertyValue('--font-size')).toBe('40px');
    expect(root.style.getPropertyValue('--margin')).toBe('60px');
  });

  it('setStatus writes and clears the indicator', () => {
    const v = new ScriptView(root);
    v.setStatus('Listener offline');
    expect(root.querySelector('.status')!.textContent).toBe('Listener offline');
    v.setStatus('');
    expect(root.querySelector('.status')!.textContent).toBe('');
  });
});
```

- [ ] **Step 3: Add jsdom + run to verify it fails**

Run: `npm install -D jsdom && npx vitest run tests/renderer/script-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/renderer/overlay/script-view.ts`**

```typescript
import type { Token } from '../../core/normalize';

export class ScriptView {
  private root: HTMLElement;
  private wordsEl: HTMLElement;
  private statusEl: HTMLElement;
  private viewEl: HTMLElement;
  private spans: HTMLSpanElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.wordsEl = root.querySelector('.words') as HTMLElement;
    this.statusEl = root.querySelector('.status') as HTMLElement;
    this.viewEl = (root.querySelector('#view') as HTMLElement) ?? this.wordsEl;
  }

  setScript(tokens: readonly Token[]): void {
    this.wordsEl.textContent = '';
    this.spans = tokens.map((t, i) => {
      const span = document.createElement('span');
      span.textContent = t.raw + ' ';
      span.dataset.i = String(i);
      this.wordsEl.appendChild(span);
      return span;
    });
  }

  setPosition(pos: number): void {
    this.spans.forEach((span, i) => {
      span.classList.toggle('read', i < pos);
      span.classList.toggle('active', i === pos);
    });
    const active = this.spans[pos];
    if (active) {
      const target = active.offsetTop - this.viewEl.clientHeight / 3;
      this.viewEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  applySettings(s: { bgOpacity: number; fontWeight: number; fontSize: number; margin: number }): void {
    this.root.style.setProperty('--bg-opacity', String(s.bgOpacity / 100));
    this.root.style.setProperty('--font-weight', String(s.fontWeight));
    this.root.style.setProperty('--font-size', `${s.fontSize}px`);
    this.root.style.setProperty('--margin', `${s.margin}px`);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/renderer/script-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/overlay/script-view.ts src/renderer/overlay/overlay.html tests/renderer/script-view.test.ts package.json package-lock.json
git commit -m "feat: ScriptView rendering, dimming, paused badge, status, settings vars"
```

---

### Task 7: `AutoScroller` — fixed-speed fallback

**Files:**
- Create: `src/renderer/overlay/auto-scroller.ts`
- Test: `tests/renderer/auto-scroller.test.ts`

**Interfaces:**
- Consumes: nothing (drives a scrollable element).
- Produces:
  - `class AutoScroller`
    - `constructor(el: { scrollTop: number }, opts?: { raf?: (cb: (t: number) => void) => number; cancel?: (h: number) => void })` — RAF injectable for tests.
    - `start(pxPerSec: number): void`
    - `stop(): void`
    - `setSpeed(pxPerSec: number): void`
    - `get running(): boolean`
  - On each tick, advances `el.scrollTop` by `pxPerSec * dt`. Used when the tracker/listener is offline (AC-06.02).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/auto-scroller.test.ts
import { describe, it, expect } from 'vitest';
import { AutoScroller } from '../../src/renderer/overlay/auto-scroller';

function fakeRaf() {
  let handle = 0;
  const cbs = new Map<number, (t: number) => void>();
  const raf = (cb: (t: number) => void) => {
    handle += 1;
    cbs.set(handle, cb);
    return handle;
  };
  const cancel = (h: number) => cbs.delete(h);
  const tick = (t: number) => {
    const current = [...cbs.entries()];
    cbs.clear();
    current.forEach(([, cb]) => cb(t));
  };
  return { raf, cancel, tick };
}

describe('AutoScroller', () => {
  it('advances scrollTop at the configured speed', () => {
    const el = { scrollTop: 0 };
    const { raf, cancel, tick } = fakeRaf();
    const s = new AutoScroller(el, { raf, cancel });
    s.start(100); // 100 px/sec
    tick(1000); // first frame sets baseline
    tick(2000); // +1s -> +100px
    expect(el.scrollTop).toBeCloseTo(100, 0);
    s.stop();
    expect(s.running).toBe(false);
  });

  it('stop halts further movement', () => {
    const el = { scrollTop: 0 };
    const { raf, cancel, tick } = fakeRaf();
    const s = new AutoScroller(el, { raf, cancel });
    s.start(100);
    tick(1000);
    s.stop();
    tick(3000);
    expect(el.scrollTop).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/renderer/auto-scroller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/overlay/auto-scroller.ts`**

```typescript
type Scrollable = { scrollTop: number };

export class AutoScroller {
  private el: Scrollable;
  private raf: (cb: (t: number) => void) => number;
  private cancel: (h: number) => void;
  private handle = 0;
  private speed = 0;
  private last = -1;
  private active = false;

  constructor(
    el: Scrollable,
    opts?: { raf?: (cb: (t: number) => void) => number; cancel?: (h: number) => void }
  ) {
    this.el = el;
    this.raf = opts?.raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = opts?.cancel ?? ((h) => cancelAnimationFrame(h));
  }

  get running(): boolean {
    return this.active;
  }

  setSpeed(pxPerSec: number): void {
    this.speed = pxPerSec;
  }

  start(pxPerSec: number): void {
    this.speed = pxPerSec;
    this.active = true;
    this.last = -1;
    this.handle = this.raf((t) => this.frame(t));
  }

  stop(): void {
    this.active = false;
    if (this.handle) this.cancel(this.handle);
    this.handle = 0;
  }

  private frame(t: number): void {
    if (!this.active) return;
    if (this.last >= 0) {
      const dt = (t - this.last) / 1000;
      this.el.scrollTop += this.speed * dt;
    }
    this.last = t;
    this.handle = this.raf((nt) => this.frame(nt));
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/renderer/auto-scroller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/overlay/auto-scroller.ts tests/renderer/auto-scroller.test.ts
git commit -m "feat: fixed-speed AutoScroller fallback"
```

---

### Task 8: Preload bridges + IPC channel contract

**Files:**
- Create: `src/preload/overlay-preload.ts`
- Create: `src/preload/control-preload.ts`
- Create: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `TranscriptMsg`, `StatusMsg`, `PromptSettings`.
- Produces (IPC channel names + preload-exposed API shapes; no test — thin glue verified via typecheck + Task 10 manual run):
  - `src/shared/ipc.ts`:
    ```typescript
    export const IPC = {
      transcript: 'transcript',      // main -> overlay: TranscriptMsg
      status: 'status',              // main -> overlay: StatusMsg
      paused: 'paused',              // main -> overlay: boolean
      settings: 'settings',          // main <-> both: PromptSettings
      position: 'position',          // overlay -> main: number (for status only)
      setScript: 'set-script',       // control -> main -> overlay: string
      manualNext: 'manual-next',     // main -> overlay
      manualPrev: 'manual-prev',     // main -> overlay
      togglePause: 'toggle-pause',   // overlay/control -> main
      openListener: 'open-listener', // control -> main
      applySettings: 'apply-settings', // control -> main (persist + fan out)
      loadScriptFile: 'load-script-file', // control -> main (dialog) -> returns string
    } as const;
    ```
  - `overlay-preload.ts` exposes `window.prompter` with: `onTranscript(cb)`, `onStatus(cb)`, `onPaused(cb)`, `onSettings(cb)`, `onScript(cb)`, `onManualNext(cb)`, `onManualPrev(cb)`, `togglePause()`, `sendPosition(n)`.
  - `control-preload.ts` exposes `window.control` with: `onSettings(cb)`, `onScript(cb)`, `applySettings(s)`, `setScript(text)`, `openListener()`, `loadScriptFile(): Promise<string>`.

- [ ] **Step 1: Implement `src/shared/ipc.ts`** (content above).

- [ ] **Step 2: Implement `src/preload/overlay-preload.ts`**

```typescript
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
});
```

- [ ] **Step 3: Implement `src/preload/control-preload.ts`**

```typescript
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
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/preload/overlay-preload.ts src/preload/control-preload.ts
git commit -m "feat: IPC channel contract and preload bridges"
```

---

### Task 9: Listener page — Web Speech in external browser

**Files:**
- Modify: `public/listener.html` (replace placeholder with full listener)

**Interfaces:**
- Consumes: `ws://<host>/ws`, `ServerToClient` (`start`/`stop`).
- Produces: sends `TranscriptMsg` frames; obeys `start`/`stop`; auto-restarts on `onend` **only when not stopped**; reports `not-allowed`/`network`/`no-speech` visibly on the page. No unit test (browser-only, Web Speech unavailable in jsdom/node); verified manually in Task 12.

- [ ] **Step 1: Replace `public/listener.html`**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Prompter Listener</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; background: #111; color: #eee; }
      #state { font-size: 18px; margin-bottom: 12px; }
      #last { opacity: 0.7; }
      .err { color: #f66; }
      .ok { color: #6f6; }
    </style>
  </head>
  <body>
    <div id="state">Menghubungkan…</div>
    <div id="last"></div>
    <p>Biarkan tab ini terbuka selama sesi. Izinkan akses mikrofon saat diminta.</p>
    <script>
      const stateEl = document.getElementById('state');
      const lastEl = document.getElementById('last');
      const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws, recog, wantRunning = false, stopped = true;

      function setState(text, cls) { stateEl.textContent = text; stateEl.className = cls || ''; }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { setState('Browser tidak mendukung Web Speech. Pakai Chrome/Edge.', 'err'); }

      function makeRecog() {
        const r = new SR();
        r.lang = 'id-ID';
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const text = res[0].transcript;
            send({ type: 'transcript', text, isFinal: res.isFinal });
            if (res.isFinal) lastEl.textContent = text;
          }
        };
        r.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            setState('Mikrofon ditolak. Izinkan akses mikrofon.', 'err');
          } else if (e.error === 'network') {
            setState('Jaringan error.', 'err');
          }
        };
        r.onend = () => { if (wantRunning && !stopped) { try { r.start(); } catch {} } };
        return r;
      }

      function startRecog() {
        if (!SR) return;
        stopped = false; wantRunning = true;
        if (!recog) recog = makeRecog();
        try { recog.start(); setState('Mendengarkan…', 'ok'); } catch {}
      }
      function stopRecog() {
        wantRunning = false; stopped = true;
        if (recog) { try { recog.stop(); } catch {} }
        setState('Dijeda.', '');
      }

      function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

      function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setState('Tersambung. Menunggu perintah…', 'ok');
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'start') startRecog();
          else if (msg.type === 'stop') stopRecog();
        };
        ws.onclose = () => { stopRecog(); setState('Terputus. Menyambung ulang…', 'err'); setTimeout(connect, 1500); };
        ws.onerror = () => {};
      }
      connect();
    </script>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/listener.html
git commit -m "feat: external-browser Web Speech listener page (id-ID)"
```

---

### Task 10: Windows + main wiring + shortcuts (integration)

**Files:**
- Create: `src/main/windows.ts`
- Create: `src/main/shortcuts.ts`
- Create: `src/main/index.ts`
- Create: `src/renderer/overlay/overlay.ts`
- Create: `src/renderer/control/control.html`
- Create: `src/renderer/control/control.ts`
- Modify: `package.json` (build step to copy html/public into `dist`)

**Interfaces:**
- Consumes: everything above (`Store`, `BridgeServer`, `Tracker`, `ScriptView`, `AutoScroller`, `IPC`, preloads).
- Produces: the runnable app. `windows.ts` exports:
  - `createOverlayWindow(preloadPath: string, htmlPath: string): BrowserWindow`
  - `createControlWindow(preloadPath: string, htmlPath: string): BrowserWindow`
  - `applyWindowMode(win: BrowserWindow, s: { alwaysOnTop: boolean; clickThrough: boolean }): void` — applies `setContentProtection(true)` always; `setAlwaysOnTop(true,'screen-saver')`+`setSkipTaskbar(true)` when on, else `setAlwaysOnTop(false)`+`setSkipTaskbar(false)`; `setIgnoreMouseEvents(clickThrough, { forward: true })`.
  - `shortcuts.ts` exports `registerShortcuts(handlers: { toggleAlwaysOnTop(): void; togglePause(): void; next(): void; prev(): void }): void` and `unregisterShortcuts(): void`, binding `Ctrl+Shift+T`, `Ctrl+Shift+Space`, `Ctrl+Shift+Right`, `Ctrl+Shift+Left`.

This task is validated by launching the app (no Vitest — Electron runtime), so its "test" steps are manual smoke checks.

- [ ] **Step 1: Implement `src/main/windows.ts`**

```typescript
import { BrowserWindow } from 'electron';

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
  if (s.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setSkipTaskbar(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
  }
  win.setIgnoreMouseEvents(s.clickThrough, { forward: true });
}
```

- [ ] **Step 2: Implement `src/main/shortcuts.ts`**

```typescript
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
```

- [ ] **Step 3: Implement `src/main/index.ts`**

```typescript
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
  server.setPaused(paused);
  server.broadcast(paused ? { type: 'stop' } : { type: 'start' });
  overlaySend(IPC.paused, paused);
}

async function boot() {
  store = new Store(app.getPath('userData'));
  settings = store.readSettings();

  const dist = __dirname; // dist/main
  const root = join(dist, '..', '..'); // project root
  const publicDir = join(root, 'public');

  server = new BridgeServer({ publicDir });
  await server.start();

  server.onTranscript((m) => {
    if (!paused) overlaySend(IPC.transcript, m);
  });
  server.onClientCount((n) => {
    overlaySend(IPC.status, { type: 'status', code: n > 0 ? 'ok' : 'listener-offline' });
  });

  overlay = createOverlayWindow(
    join(dist, '..', 'preload', 'overlay-preload.js'),
    join(dist, '..', 'renderer', 'overlay', 'overlay.html')
  );
  control = createControlWindow(
    join(dist, '..', 'preload', 'control-preload.js'),
    join(dist, '..', 'renderer', 'control', 'control.html')
  );

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
}

app.whenReady().then(boot);
app.on('will-quit', () => {
  unregisterShortcuts();
  server?.stop();
});
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 4: Implement `src/renderer/overlay/overlay.ts`**

```typescript
import { Tracker } from '../../core/tracker';
import { ScriptView } from './script-view';
import { AutoScroller } from './auto-scroller';
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
    };
  }
}

const root = document.body;
const view = new ScriptView(root);
const viewEl = document.getElementById('view') as HTMLElement;
const scroller = new AutoScroller(viewEl);

let tracker = new Tracker('');
let paused = false;
let autoSpeed = 40;

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
});

window.prompter.onTranscript((m) => {
  if (paused) return;
  if (scroller.running) scroller.stop(); // speech resumed -> leave fallback
  tracker.feed(m.text, m.isFinal);
  refresh();
  view.setStatus(tracker.status === 'lost' ? 'Posisi tidak ditemukan' : '');
});

window.prompter.onStatus((m) => {
  if (m.code === 'listener-offline') {
    view.setStatus('Listener offline');
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'network') {
    view.setStatus('Jaringan error');
    if (!paused) scroller.start(autoSpeed);
  } else if (m.code === 'mic-denied') {
    view.setStatus('Mikrofon ditolak');
  } else {
    view.setStatus('');
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

document.getElementById('pauseBtn')?.addEventListener('click', () => window.prompter.togglePause());
```

- [ ] **Step 5: Implement `src/renderer/control/control.html`**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Prompter — Kontrol</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 16px; }
      label { display: block; margin: 10px 0 2px; font-size: 13px; }
      textarea { width: 100%; height: 200px; }
      .row { display: flex; gap: 8px; align-items: center; }
      button { margin-top: 12px; }
    </style>
  </head>
  <body>
    <h3>Naskah</h3>
    <textarea id="script" placeholder="Tempel naskah di sini…"></textarea>
    <div class="row">
      <button id="loadFile">Muat dari file…</button>
      <button id="openListener">Buka listener di browser</button>
    </div>

    <h3>Tampilan</h3>
    <label>Transparansi latar <span id="bgVal"></span></label>
    <input id="bgOpacity" type="range" min="0" max="100" />
    <label>Tebal huruf <span id="fwVal"></span></label>
    <input id="fontWeight" type="range" min="300" max="900" step="100" />
    <label>Ukuran font <span id="fsVal"></span></label>
    <input id="fontSize" type="range" min="16" max="72" />
    <label>Margin <span id="mVal"></span></label>
    <input id="margin" type="range" min="0" max="160" />
    <label>Kecepatan auto-scroll <span id="asVal"></span></label>
    <input id="autoScrollSpeed" type="range" min="0" max="200" />

    <h3>Mode</h3>
    <label><input id="alwaysOnTop" type="checkbox" /> Selalu di atas (Ctrl+Shift+T)</label>
    <label><input id="clickThrough" type="checkbox" /> Klik tembus</label>

    <script src="./control.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Implement `src/renderer/control/control.ts`**

```typescript
import type { PromptSettings } from '../../main/settings';

declare global {
  interface Window {
    control: {
      onSettings(cb: (s: PromptSettings) => void): void;
      onScript(cb: (t: string) => void): void;
      applySettings(s: PromptSettings): void;
      setScript(text: string): void;
      openListener(): void;
      loadScriptFile(): Promise<string>;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scriptEl = $('script') as HTMLTextAreaElement;
let current: PromptSettings;

const sliders: (keyof PromptSettings)[] = [
  'bgOpacity',
  'fontWeight',
  'fontSize',
  'margin',
  'autoScrollSpeed',
];
const valIds: Record<string, string> = {
  bgOpacity: 'bgVal',
  fontWeight: 'fwVal',
  fontSize: 'fsVal',
  margin: 'mVal',
  autoScrollSpeed: 'asVal',
};

function reflect(s: PromptSettings) {
  current = s;
  for (const k of sliders) {
    ($(k) as HTMLInputElement).value = String(s[k]);
    $(valIds[k]).textContent = String(s[k]);
  }
  ($('alwaysOnTop') as HTMLInputElement).checked = s.alwaysOnTop;
  ($('clickThrough') as HTMLInputElement).checked = s.clickThrough;
}

function push() {
  const next: PromptSettings = { ...current };
  for (const k of sliders) {
    (next[k] as number) = Number(($(k) as HTMLInputElement).value);
    $(valIds[k]).textContent = ($(k) as HTMLInputElement).value;
  }
  next.alwaysOnTop = ($('alwaysOnTop') as HTMLInputElement).checked;
  next.clickThrough = ($('clickThrough') as HTMLInputElement).checked;
  current = next;
  window.control.applySettings(next);
}

window.control.onSettings(reflect);
window.control.onScript((t) => (scriptEl.value = t));

[...sliders, 'alwaysOnTop', 'clickThrough'].forEach((id) =>
  $(id).addEventListener('input', push)
);

scriptEl.addEventListener('input', () => window.control.setScript(scriptEl.value));
$('openListener').addEventListener('click', () => window.control.openListener());
$('loadFile').addEventListener('click', async () => {
  const text = await window.control.loadScriptFile();
  if (text) {
    scriptEl.value = text;
    window.control.setScript(text);
  }
});
```

- [ ] **Step 7: Update `package.json` build to copy assets and bundle renderer entries**

Renderer `.ts` files must be reachable as `.js` next to their `.html`. Add a copy step for `.html`/`public`, and compile renderer/preload with tsc (already covered by `tsc`, which emits to `dist/` mirroring `src/`). Update scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-assets.mjs",
    "start": "npm run build && electron .",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Create `scripts/copy-assets.mjs`:

```javascript
import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const copies = [
  ['src/renderer/overlay/overlay.html', 'dist/renderer/overlay/overlay.html'],
  ['src/renderer/control/control.html', 'dist/renderer/control/control.html'],
];
for (const [from, to] of copies) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}
```

Note: the overlay/control HTML reference `./overlay.js` and `./control.js`. tsc emits `dist/renderer/overlay/overlay.js` and `dist/renderer/control/control.js` from the `.ts` sources, so the relative script tags resolve. `main/index.ts` serves `public/` from the project root (not copied), so `listener.html` stays at `public/listener.html`.

- [ ] **Step 8: Build + manual smoke run**

Run: `npm run start`
Expected: overlay + control windows open. Verify:
- Overlay is frameless/transparent and on top by default.
- Paste script in control → overlay shows the words.
- Move the four display sliders → overlay updates live (AC-02.01–03).
- Toggle "Selalu di atas" → overlay leaves/enters taskbar (AC-01.01/05).
- Toggle "Klik tembus" → clicks pass through except the Pause button (AC-01.04, AC-05.01).
- `Ctrl+Shift+Space` toggles PAUSED badge (AC-05.02/04).
- "Buka listener di browser" opens the listener URL in the default browser (AC-06.03 offline path shows "Listener offline" until it connects).

- [ ] **Step 9: Commit**

```bash
git add src/main/windows.ts src/main/shortcuts.ts src/main/index.ts src/renderer/overlay/overlay.ts src/renderer/control/control.html src/renderer/control/control.ts scripts/copy-assets.mjs package.json
git commit -m "feat: windows, global shortcuts, main wiring, control + overlay renderers"
```

---

### Task 11: End-to-end voice-follow + pause/reconnect integration

**Files:**
- Test: `tests/main/e2e-bridge.test.ts`

**Interfaces:**
- Consumes: `BridgeServer`, `Tracker` — asserts the *server + tracker* contract that the manual run relies on (the parts that are testable without Electron): a transcript sent over WS advances a Tracker fed from `onTranscript`, and pausing stops delivery + tells a reconnecting client to stop.

- [ ] **Step 1: Write the integration test**

```typescript
// tests/main/e2e-bridge.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeServer } from '../../src/main/server';
import { Tracker } from '../../src/core/tracker';

function pub() {
  const d = mkdtempSync(join(tmpdir(), 'pub-'));
  writeFileSync(join(d, 'listener.html'), '<!doctype html><title>x</title>');
  return d;
}
let server: BridgeServer;
afterEach(async () => await server?.stop());

function connect(url: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}

describe('bridge + tracker e2e', () => {
  it('a transcript over WS advances the tracker (when not paused)', async () => {
    server = new BridgeServer({ publicDir: pub() });
    const port = await server.start();
    const tracker = new Tracker('selamat pagi semua hari ini');
    let paused = false;
    server.onTranscript((m) => {
      if (!paused) tracker.feed(m.text, m.isFinal);
    });
    const ws = await connect(`ws://127.0.0.1:${port}/ws`);
    ws.send(JSON.stringify({ type: 'transcript', text: 'selamat pagi semua', isFinal: true }));
    await new Promise((r) => setTimeout(r, 60));
    expect(tracker.position).toBeGreaterThanOrEqual(3);
    ws.close();
  });

  it('paused: transcript is dropped and reconnecting client is told to stop', async () => {
    server = new BridgeServer({ publicDir: pub() });
    const port = await server.start();
    const tracker = new Tracker('selamat pagi semua');
    let paused = true;
    server.setPaused(true);
    server.onTranscript((m) => {
      if (!paused) tracker.feed(m.text, m.isFinal);
    });
    const ws = await connect(`ws://127.0.0.1:${port}/ws`);
    const first = await new Promise<any>((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
    expect(first).toEqual({ type: 'stop' }); // reconnect safety (AC-05.06)
    ws.send(JSON.stringify({ type: 'transcript', text: 'selamat pagi semua', isFinal: true }));
    await new Promise((r) => setTimeout(r, 60));
    expect(tracker.position).toBe(0); // dropped while paused (AC-05.03)
    ws.close();
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run tests/main/e2e-bridge.test.ts`
Expected: PASS.

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/main/e2e-bridge.test.ts
git commit -m "test: e2e bridge + tracker follow and pause/reconnect safety"
```

---

### Task 12: Manual acceptance & README

**Files:**
- Create: `README.md`

**Interfaces:** none (docs + human verification of screen-share invisibility, which cannot be unit-tested).

- [ ] **Step 1: Write `README.md`**

Include: what it is; prerequisites (Windows 11, internet, Chrome/Edge for the listener); `npm install`; `npm start`; how to open the listener tab and grant mic; shortcut reference (`Ctrl+Shift+T`, `Ctrl+Shift+Space`, `Ctrl+Shift+Left/Right`); the note that the listener tab must stay open; and the screen-share invisibility caveat (Windows 10 2004+ / Windows 11; some capture methods differ — verify manually).

- [ ] **Step 2: Manual acceptance pass (human)**

Walk the spec §7 manual checklist:
- AC-01.02: share full screen in Zoom or Meet → confirm the overlay is invisible to participants (self-view/second account).
- Read a mixed ID/English script → confirm follow lag < ~1s (AC-04.02) and that skips/mishears/English-phonetic words don't lose position (AC-04.03).
- Speak off-script → position holds (AC-04.04). Repeat a sentence → still followed (AC-04.05). Duplicate sentence → no far jump (AC-04.06).
- Pause mid-read → mic stops, PAUSED shown, last sentence highlighted; continue → resumes from frozen position (AC-05.*).
- Disconnect internet → AutoScroller fallback engages; reconnect → voice mode resumes (AC-06.02).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, shortcuts, and manual acceptance checklist"
```

---

## Self-Review

**1. Spec coverage:**
- US-01 always-on-top toggle + persist + default on → Task 4 (default), Task 10 (toggle/shortcut/persist). AC-01.05 taskbar/Alt+Tab behavior → `applyWindowMode` (Task 10). AC-01.02 content protection → `setContentProtection(true)` always (Tasks 10, verified Task 12). AC-01.03 move/resize → overlay window `movable/resizable` (Task 10). AC-01.04 click-through except controls → `setIgnoreMouseEvents(...,{forward})` + `-webkit-app-region: no-drag` on controls (Tasks 6, 10).
- US-02 sliders + live + persist → Tasks 6 (`applySettings` CSS vars), 4 (persist), 10 (control UI). ✓
- US-03 paste/load-file/persist → Task 10 (control + `loadScriptFile`), Task 4 (persist). ✓
- US-04 follow/dim/read-line/tolerance/no-far-jump → Tasks 3 (Tracker, all AC-04.03–06 tested), 6 (dim + read-line scroll). AC-04.02 lag is a manual check (Task 12). ✓
- US-05 pause/continue/mic-off/frozen/reconnect-safe → Tasks 5 (pause-aware server), 10 (setPaused broadcast + shortcut + button), 6 (PAUSED badge), 11 (dropped-while-paused + reconnect-stop test). ✓
- US-06 manual next/prev, autoscroll fallback, small status indicators → Tasks 3 (next/prev sentence), 7 (AutoScroller), 10 (shortcuts + status), 6 (status indicator). ✓
- Server port fallback 47821→47830, 127.0.0.1 only → Task 5. ✓
- Error handling table → listener page states (Task 9), overlay status handling (Task 10), autoscroll on network/offline (Task 10). ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" left; every code step has concrete code. The listener `public/listener.html` starts as an intentional placeholder in Task 5 (needed so the server has a file to serve) and is fully implemented in Task 9 — this is sequenced, not a gap.

**3. Type consistency:** `PromptSettings` fields (`alwaysOnTop, clickThrough, bgOpacity, fontWeight, fontSize, margin, autoScrollSpeed`) are used identically in `settings.ts`, `control.ts`, `overlay.ts`, `windows.applyWindowMode` (subset), and IPC. `Tracker` API (`feed/position/setPosition/nextSentence/prevSentence/status/tokens`) matches usage in `overlay.ts`. `ScriptView` methods (`setScript/setPosition/setPaused/setStatus/applySettings`) match `overlay.ts`. `BridgeServer` methods (`start/stop/url/broadcast/onTranscript/onClientCount/setPaused`) match `index.ts` and tests. Message types (`TranscriptMsg/ControlMsg/StatusMsg`) consistent across `messages.ts`, server, listener, IPC. IPC channel constants centralized in `ipc.ts` and used by both preloads + main. ✓
