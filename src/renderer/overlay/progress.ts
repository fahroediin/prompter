export function progressLabel(position: number, total: number): string {
  const pos = Math.min(position, total);
  const pct = total > 0 ? Math.round((pos / total) * 100) : 0;
  return `${pos} / ${total} kata (${pct}%)`;
}
