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
// Final words kept from earlier speech results as context for the next one.
const CONTEXT_WORDS = 6;

// Local alignment (Smith-Waterman-like) of heard tokens against a script slice
// that ENDS at scriptEnd (exclusive). The alignment must end at the LAST row
// (i.e. at script token scriptEnd-1) — otherwise "ending at j" is meaningless
// and callers can't apply position rules (interim-advance-only, final-retreat
// clamp) relative to j. Returns {score, matched} for the best alignment whose
// last step MATCHES script token scriptEnd-1 with a heard word at column >=
// firstNewCol: "position j" means the speaker just said word j-1. Ending on a
// gap instead would let words carried over as context match on their own.
function alignEndingAt(
  script: Token[],
  scriptEnd: number,
  heard: Token[],
  firstNewCol = 1
): { score: number; matched: number } {
  const start = Math.max(0, scriptEnd - (heard.length + 6));
  const s = script.slice(start, scriptEnd);
  const m = s.length;
  const n = heard.length;
  if (m === 0) return { score: 0, matched: 0 };
  // dp[i][j] = best local score of alignment ending at s[i-1],heard[j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const mt: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
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
    }
  }
  // Anchor at the last script row (i = m) through a diagonal match with a
  // newly heard word. Take the best score across those endpoints.
  let best = 0;
  let bestMatched = 0;
  for (let j = Math.max(1, firstNewCol); j <= n; j++) {
    const ps = pairScore(s[m - 1], heard[j - 1]);
    if (ps < 1) continue;
    const score = dp[m - 1][j - 1] + ps;
    if (score > best) {
      best = score;
      bestMatched = mt[m - 1][j - 1] + 1;
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
  private context: Token[] = [];
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
    // Split while KEEPING whitespace separators so a newline between tokens
    // (which /\s+/ would otherwise silently swallow) can still be detected as
    // a sentence boundary, alongside '.', '!', '?' inside a token itself.
    const parts = text.split(/(\s+)/);
    for (const part of parts) {
      if (/^\s+$/.test(part)) {
        if (part.includes('\n')) atStart = true;
        continue;
      }
      const raw = part;
      const stripped = raw.replace(/[^\p{L}\p{N}]/gu, '');
      if (stripped) {
        if (atStart) {
          starts.push(count);
          atStart = false;
        }
        count++;
      }
      if (/[.!?]/.test(raw)) atStart = true;
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
    const next = Math.max(0, Math.min(pos, this.tokens.length));
    // The context described where the speaker was; a manual move invalidates it.
    if (next !== this.pos) this.context = [];
    this.pos = next;
    this.lastMatchAt = this.now();
  }

  // Chrome splits continuous speech into separate results after short pauses,
  // often a single word, and each result arrives here on its own. A lone word
  // can never reach the 2-matched-words threshold, so the last few final words
  // are prepended as context. Matches must still end on a new word.
  feed(text: string, isFinal: boolean): number {
    const segment = heardTokens(text, isFinal);
    if (segment.length === 0) return this.pos;
    const pos = this.align([...this.context, ...segment], this.context.length + 1, isFinal);
    if (isFinal) this.context = [...this.context, ...segment].slice(-CONTEXT_WORDS);
    return pos;
  }

  private align(heard: Token[], firstNewCol: number, isFinal: boolean): number {

    // Search window for candidate ends `j`, per spec §4 step 2: pos-5..pos+40.
    // The loop includes `lo` itself (via Math.max(1, lo), since j=0 would be
    // an empty match) so that a retreat of exactly 5 tokens is reachable —
    // starting at `lo + 1` would silently exclude the pos-5 candidate and cap
    // the achievable retreat at 4. The final-retreat clamp below is a
    // defensive guard: because the window's own floor already excludes any
    // candidate more than 5 tokens behind pos, `bestEnd < this.pos - 5` should
    // never actually trigger in practice, but the code keeps it in case the
    // window bounds ever change.
    const lo = Math.max(0, this.pos - 5);
    const hi = Math.min(this.tokens.length, this.pos + 40);

    let bestEnd = -1;
    let bestScore = -Infinity;
    for (let j = Math.max(1, lo); j <= hi; j++) {
      const { score, matched } = alignEndingAt(this.tokens, j, heard, firstNewCol);
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
