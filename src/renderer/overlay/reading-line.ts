// Given each word's top offset (ascending, several words share a line) and the
// y of the reading line, return the index of the first word on the line the
// reading line falls on. Used to sync the tracker to a manual scroll. If
// `current` is already on that line it is kept, so a sentence starting
// mid-line is not snapped back to the line start.
export function indexAtReadingLine(tops: readonly number[], line: number, current?: number): number {
  let lineTop = -Infinity;
  for (const top of tops) {
    if (top > line) break;
    lineTop = top;
  }
  if (lineTop === -Infinity) return 0;
  if (current !== undefined && tops[current] === lineTop) return current;
  return tops.indexOf(lineTop);
}
