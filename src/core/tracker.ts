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
// Score cost per script word skipped beyond what the new speech explains.
const JUMP_PENALTY = 0.25;
// Most skipped words for which the context may still support a candidate.
const CONTEXT_REACH = 3;
// Script words before a manually chosen position that count as already said.
// Two let a lone word match up to ~6 words past the new position (skipping a
// sentence's first words) but not further.
const MOVE_CONTEXT_WORDS = 2;

// Local alignment (Smith-Waterman-like) of heard tokens against a script slice
// that ENDS at scriptEnd (exclusive). The alignment must end at the LAST row
// (i.e. at script token scriptEnd-1) — otherwise "ending at j" is meaningless
// and callers can't apply position rules (interim-advance-only, final-retreat
// clamp) relative to j. Returns {score, matched, col} for the best alignment
// whose last step MATCHES script token scriptEnd-1 with the heard word at
// column `col` (1-based, >= firstNewCol): "position j" means the speaker just
// said word j-1. Ending on a gap instead would let words carried over as
// context match on their own.
function alignEndingAt(
  script: Token[],
  scriptEnd: number,
  heard: Token[],
  firstNewCol = 1
): { score: number; matched: number; col: number } {
  const start = Math.max(0, scriptEnd - (heard.length + 6));
  const s = script.slice(start, scriptEnd);
  const m = s.length;
  const n = heard.length;
  if (m === 0) return { score: 0, matched: 0, col: 0 };
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
  let bestCol = 0;
  for (let j = Math.max(1, firstNewCol); j <= n; j++) {
    const ps = pairScore(s[m - 1], heard[j - 1]);
    if (ps < 1) continue;
    const score = dp[m - 1][j - 1] + ps;
    if (score > best) {
      best = score;
      bestMatched = mt[m - 1][j - 1] + 1;
      bestCol = j;
    }
  }
  return { score: best, matched: bestMatched, col: bestCol };
}

// The last words of a result used for alignment: 12 for a final, 6 for an interim.
function recentWords(all: Token[], isFinal: boolean): Token[] {
  return all.slice(-(isFinal ? 12 : 6));
}

// Chrome's interim results for one utterance grow word by word, each repeating
// the words before (as does the final). True if `all` continues `previous`.
function continues(all: Token[], previous: readonly string[]): boolean {
  return (
    previous.length > 0 &&
    previous.length <= all.length &&
    previous.every((w, i) => all[i].norm === w)
  );
}

export class Tracker {
  readonly tokens: Token[];
  readonly sentenceStarts: number[];
  private pos = 0;
  private context: Token[] = [];
  // Words heard since the position last moved, i.e. not yet accounted for:
  // earlier finals, plus the current utterance past `utteranceUsed` words.
  private unusedFinal: Token[] = [];
  private utteranceUsed = 0;
  private lastInterim: string[] = [];
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
    // The heard context described where the speaker was; after a manual move
    // (click, slider, prev/next) the speaker starts at `next`, so the script
    // words just before it count as said. Otherwise the first word spoken
    // there has no companion and can never reach the 2-matched threshold.
    if (next !== this.pos) {
      this.context = this.tokens.slice(Math.max(0, next - MOVE_CONTEXT_WORDS), next);
      this.unusedFinal = [];
      this.utteranceUsed = this.lastInterim.length;
    }
    this.pos = next;
    this.lastMatchAt = this.now();
  }

  // Chrome splits continuous speech into separate results after short pauses,
  // often a single word, and each result arrives here on its own. A lone word
  // can never reach the 2-matched-words threshold, so the last few final words
  // are prepended as context. Matches must still end on a new word.
  feed(text: string, isFinal: boolean): number {
    const all = normalize(text);
    if (all.length === 0) return this.pos;
    if (!continues(all, this.lastInterim)) this.utteranceUsed = 0;
    const segment = recentWords(all, isFinal);
    const unused = [...this.unusedFinal, ...all.slice(this.utteranceUsed)].slice(-12);

    const match = this.align(segment, unused, isFinal);
    // The words up to where the accepted match ended are accounted for, even
    // if the position did not move; later words stay unused.
    if (match?.from === 'segment') {
      this.unusedFinal = [];
      this.utteranceUsed = Math.max(this.utteranceUsed, all.length - segment.length + match.col);
    } else if (match?.from === 'unused') {
      const fromFinals = Math.min(match.col, this.unusedFinal.length);
      this.utteranceUsed += match.col - fromFinals;
      this.unusedFinal = this.unusedFinal.slice(fromFinals);
    }

    if (isFinal) {
      this.unusedFinal = [...this.unusedFinal, ...all.slice(this.utteranceUsed)].slice(-12);
      this.context = [...this.context, ...recentWords(all, true)].slice(-CONTEXT_WORDS);
      this.utteranceUsed = 0;
      this.lastInterim = [];
    } else {
      this.lastInterim = all.map((t) => t.norm);
    }
    return this.pos;
  }

  // `segment`: the latest result's words, aligned after the context for nearby
  // candidates. `unused`: words heard but not yet accounted for by a match;
  // the speaker may be up to that many words ahead, and only these may
  // support a farther candidate. Returns the accepted match (null if none):
  // which word list it ended in and at which 1-based column.
  private align(
    segment: Token[],
    unused: Token[],
    isFinal: boolean
  ): { from: 'segment' | 'unused'; col: number } | null {
    const withContext = [...this.context, ...segment];
    const firstNewCol = this.context.length + 1;
    const budget = Math.max(1, unused.length);

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

    // Moving ahead further than the unused words explain means script words
    // were skipped; each costs JUMP_PENALTY. Otherwise, in text with repeated
    // passages, a couple of common words match a later copy just as well as
    // the nearby one and the position leaps ahead. Context words that already
    // brought the position here only support nearby candidates; a farther one
    // must be matched by unused words alone. A strong match can still pay for
    // a real skip (e.g. lines the speaker does not read). Going back is only
    // right when the speaker repeats words, so a candidate behind the position
    // is judged on the latest words alone, never on context.
    let bestEnd = -1;
    let bestScore = -Infinity;
    let best: { from: 'segment' | 'unused'; col: number } | null = null;
    for (let j = Math.max(1, lo); j <= hi; j++) {
      const skipped = Math.max(0, j - this.pos - budget);
      let aligned: { score: number; matched: number; col: number };
      let from: 'segment' | 'unused';
      if (j < this.pos) {
        aligned = alignEndingAt(this.tokens, j, segment);
        from = 'segment';
      } else if (skipped <= CONTEXT_REACH) {
        aligned = alignEndingAt(this.tokens, j, withContext, firstNewCol);
        aligned = { ...aligned, col: aligned.col - this.context.length };
        from = 'segment';
      } else {
        aligned = alignEndingAt(this.tokens, j, unused);
        from = 'unused';
      }
      const score = aligned.score - JUMP_PENALTY * skipped;
      if (score < 3 || aligned.matched < 2) continue;
      // tie-break: prefer nearest to current pos
      const better =
        score > bestScore ||
        (score === bestScore &&
          Math.abs(j - this.pos) < Math.abs(bestEnd - this.pos));
      if (better) {
        bestScore = score;
        bestEnd = j;
        best = { from, col: aligned.col };
      }
    }

    if (bestEnd < 0) {
      // no acceptable match; leave lastMatchAt so status can go 'lost'
      return null;
    }

    // interim may only advance; final may retreat up to 5 tokens
    if (!isFinal && bestEnd < this.pos) {
      return null;
    }
    if (isFinal && bestEnd < this.pos - 5) {
      bestEnd = this.pos; // ignore too-far retreat
    }

    this.pos = bestEnd;
    this.lastMatchAt = this.now();
    return best;
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
