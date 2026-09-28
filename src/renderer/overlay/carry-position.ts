/**
 * Pure helper for R16: when the script text changes (e.g. edited live in the
 * control window), the new Tracker must not reset to position 0 — that would
 * break AC-05.05 and effectively AC-04, since Tracker.feed only searches
 * pos-5..pos+40 around the current position.
 *
 * Returns the position to carry into the new Tracker, clamped to the new
 * token count (a shorter edited script can't keep an out-of-range position).
 */
export function carryPosition(oldPos: number, newTokenCount: number): number {
  return Math.max(0, Math.min(oldPos, newTokenCount));
}
