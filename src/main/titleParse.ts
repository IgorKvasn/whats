export function parseUnread(title: string): number {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const rest = trimmed.slice(1);
  const match = rest.match(/^(\d+)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}
