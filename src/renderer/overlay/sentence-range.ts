/**
 * Pure helper for R6 (spec AC-05.04): when paused, the overlay highlights the
 * last sentence — the sentence containing token index `position - 1`.
 *
 * Returns the [start, end) token range of that sentence, or null when there is
 * no prior token (position <= 0) to anchor on.
 */
export function lastSentenceRange(
  sentenceStarts: readonly number[],
  position: number,
  tokenCount: number
): [number, number] | null {
  if (position <= 0 || tokenCount <= 0) return null;
  const anchor = position - 1;

  let start = sentenceStarts.length > 0 ? sentenceStarts[0] : 0;
  let end = tokenCount;
  for (let i = 0; i < sentenceStarts.length; i++) {
    if (sentenceStarts[i] <= anchor) {
      start = sentenceStarts[i];
      end = i + 1 < sentenceStarts.length ? sentenceStarts[i + 1] : tokenCount;
    } else {
      break;
    }
  }
  return [start, end];
}
