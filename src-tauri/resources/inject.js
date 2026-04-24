(function () {
  'use strict';

  // NOTE: parseUnread and notification shim mirror src-tauri/resources/inject.lib.js,
  // which is the unit-tested source of truth. Keep them in sync.

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
    console.warn('[whats] Tauri IPC not available; bridge disabled.');
    return;
  }
  const { invoke } = tauri.core;

  function safeInvoke(name, args) {
    try {
      return invoke(name, args).catch((e) =>
        console.warn('[whats] invoke', name, 'rejected', e)
      );
    } catch (e) {
      console.warn('[whats] invoke', name, 'threw', e);
    }
  }

  // --- title watcher ---
  function parseUnread(title) {
    const trimmed = (title || '').trimStart();
    if (!trimmed.startsWith('(')) return 0;
    const rest = trimmed.slice(1);
    const m = rest.match(/^(\d+)/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 0;
  }

  let lastUnread = -1;
  function pushTitle() {
    const n = parseUnread(document.title);
    if (n !== lastUnread) {
      lastUnread = n;
      safeInvoke('report_unread', { count: n });
    }
  }
  function watchTitle() {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(pushTitle).observe(titleEl, {
        subtree: true,
        characterData: true,
        childList: true,
      });
    }
    pushTitle();
  }

  // --- notification interceptor ---
  function installNotificationShim() {
    function Shim(title, options) {
      const body = options && typeof options.body === 'string' ? options.body : null;
      safeInvoke('notify_message', { sender: String(title || ''), body });
      return { close: function () {} };
    }
    Shim.permission = 'granted';
    Shim.requestPermission = function (cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    };
    try {
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: Shim,
      });
    } catch (e) {
      console.warn('[whats] Notification shim install failed', e);
    }
  }

  // --- disconnected detector ---
  let lastDisconnected = null;
  function detectDisconnected() {
    const text = (document.body && document.body.innerText) || '';
    const isDisc =
      /phone not connected/i.test(text) ||
      /computer not connected/i.test(text) ||
      /trouble connecting/i.test(text);
    if (isDisc !== lastDisconnected) {
      lastDisconnected = isDisc;
      safeInvoke('report_disconnected', { disconnected: isDisc });
    }
  }

  // bootstrap: run as soon as DOM is usable
  function boot() {
    installNotificationShim();
    watchTitle();
    detectDisconnected();
    setInterval(detectDisconnected, 5000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
