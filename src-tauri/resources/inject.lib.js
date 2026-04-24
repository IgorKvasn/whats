export function parseUnread(title) {
  const trimmed = (title || '').trimStart();
  if (!trimmed.startsWith('(')) return 0;
  const m = trimmed.slice(1).match(/^(\d+)/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
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
