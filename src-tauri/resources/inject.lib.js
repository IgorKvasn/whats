export function parseUnread(title) {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const m = trimmed.slice(1).match(/^(\d+)/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readCandidate(doc, selector) {
  const el = doc && typeof doc.querySelector === 'function' ? doc.querySelector(selector) : null;
  if (!el) return '';
  return normalizeText(el.getAttribute?.('title') || el.textContent);
}

export function makeNotificationShim(invokeFn) {
  function Shim(title, options) {
    const body = options && typeof options.body === 'string' ? options.body : null;
    invokeFn('notify_message', { sender: String(title || ''), body });
    return { close: function () {} };
  }
  Shim.permission = 'granted';
  Shim.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  return Shim;
}

export function shouldNotifyFromUnreadDelta({
  previousUnread,
  nextUnread,
  nowMs,
  lastDirectNotificationAtMs,
  dedupeWindowMs,
}) {
  if (!Number.isFinite(previousUnread) || previousUnread < 0) return false;
  if (!Number.isFinite(nextUnread) || nextUnread <= previousUnread) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(lastDirectNotificationAtMs)) return true;
  return nowMs - lastDirectNotificationAtMs >= dedupeWindowMs;
}

export function pickFallbackNotificationPayload(doc) {
  const sender =
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
