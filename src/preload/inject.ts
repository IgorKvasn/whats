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

type InvokeFn = (command: string, args: Record<string, unknown>) => void;

export interface NotificationShim {
  (title: string, options?: { body?: string }): { close: () => void };
  permission: string;
  requestPermission: (cb?: (result: string) => void) => Promise<string>;
}

export function makeNotificationShim(invokeFn: InvokeFn): NotificationShim {
  function Shim(title: string, options?: { body?: string }): { close: () => void } {
    const body = options && typeof options.body === 'string' ? options.body : null;
    invokeFn('notify_message', { sender: String(title || ''), body });
    return { close() {} };
  }
  Shim.permission = 'granted';
  Shim.requestPermission = function (cb?: (result: string) => void): Promise<string> {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  return Shim as unknown as NotificationShim;
}

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
  const sender =
    readCandidate(doc, '#main header [title]') ||
    readCandidate(doc, 'header [title]') ||
    readCandidate(doc, '[aria-label*="Unread"] [title]') ||
    readCandidate(doc, '[data-testid="cell-frame-title"] [title]');

  if (!sender) return null;

  const body =
    readCandidate(doc, '[data-pre-plain-text] span[dir="auto"]') ||
    readCandidate(doc, '[aria-label*="Unread"] span[dir="auto"]') ||
    null;

  return { sender, body };
}
