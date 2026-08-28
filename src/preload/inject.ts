export function parseUnread(title: string): number {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const rest = trimmed.slice(1);
  const match = rest.match(/^(\d+)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readCandidate(doc: Document, selector: string): string {
  const el = doc?.querySelector?.(selector);
  if (!el) return '';
  const text = normalizeText(
    (el as HTMLElement).getAttribute?.('title') || (el as HTMLElement).textContent,
  );
  if (NON_SENDER_LABELS.has(text.toLowerCase())) return '';
  return text;
}

const NON_SENDER_LABELS: ReadonlySet<string> = new Set([
  'profile details',
  'contact info',
  'group info',
  'disappearing messages',
  'search messages',
  'business info',
  'whatsapp',
]);

export interface UnreadDeltaDetails {
  previousUnread: number;
  nextUnread: number;
  nowMs: number;
  lastDirectNotificationAtMs: number;
  dedupeWindowMs: number;
}

export function shouldNotifyFromUnreadDelta(details: UnreadDeltaDetails): boolean {
  if (!Number.isFinite(details.previousUnread) || details.previousUnread < 0) return false;
  if (!Number.isFinite(details.nextUnread) || details.nextUnread <= details.previousUnread)
    return false;
  if (!Number.isFinite(details.nowMs)) return false;
  if (!Number.isFinite(details.lastDirectNotificationAtMs)) return true;
  return details.nowMs - details.lastDirectNotificationAtMs >= details.dedupeWindowMs;
}

export function pickFallbackNotificationPayload(
  doc: Document,
): { sender: string; body: string | null } | null {
  const unreadSender =
    readCandidate(doc, '[aria-label*="Unread"] [title]') ||
    readCandidate(doc, '[data-testid="cell-frame-title"] [title]');
  if (unreadSender) {
    return {
      sender: unreadSender,
      body: readCandidate(doc, '[aria-label*="Unread"] span[dir="auto"]') || null,
    };
  }

  const activeSender =
    readCandidate(doc, '#main header [title]') ||
    readCandidate(doc, 'header [title]');

  if (!activeSender) return null;

  return {
    sender: activeSender,
    body: readCandidate(doc, '[data-pre-plain-text] span[dir="auto"]') || null,
  };
}
