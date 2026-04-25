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
  function forwardNotification(title, options) {
    const body = options && typeof options.body === 'string' ? options.body : null;
    console.log('[whats] forwarding notification', { title, bodyLen: body ? body.length : 0 });
    safeInvoke('notify_message', { sender: String(title || ''), body });
  }

  function installNotificationShim() {
    function Shim(title, options) {
      forwardNotification(title, options);
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
      console.log('[whats] Notification shim installed');
    } catch (e) {
      console.warn('[whats] Notification shim install failed', e);
    }

    // WhatsApp Web actually delivers message notifications via
    // ServiceWorkerRegistration.showNotification() from its service worker.
    // The shim above only catches `new Notification(...)`. Patch the
    // registration path on the page side as well: every registration
    // returned by navigator.serviceWorker gets its showNotification wrapped.
    try {
      const swc = navigator.serviceWorker;
      if (swc) {
        function wrapRegistration(reg) {
          if (!reg || reg.__whatsPatched) return reg;
          const original = reg.showNotification ? reg.showNotification.bind(reg) : null;
          reg.showNotification = function (title, options) {
            forwardNotification(title, options);
            if (original) {
              try { return original(title, options); } catch (_) {}
            }
            return Promise.resolve();
          };
          reg.__whatsPatched = true;
          return reg;
        }
        const origGetReg = swc.getRegistration ? swc.getRegistration.bind(swc) : null;
        if (origGetReg) {
          swc.getRegistration = function () {
            return origGetReg.apply(null, arguments).then(wrapRegistration);
          };
        }
        const origGetRegs = swc.getRegistrations ? swc.getRegistrations.bind(swc) : null;
        if (origGetRegs) {
          swc.getRegistrations = function () {
            return origGetRegs.apply(null, arguments).then(function (regs) {
              return regs.map(wrapRegistration);
            });
          };
        }
        const origReady = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(swc), 'ready');
        // `ready` is a getter returning a Promise<ServiceWorkerRegistration>.
        // Wrap by intercepting the resolved registration.
        if (swc.ready && typeof swc.ready.then === 'function') {
          swc.ready.then(wrapRegistration).catch(function () {});
        }
        const origRegister = swc.register ? swc.register.bind(swc) : null;
        if (origRegister) {
          swc.register = function () {
            return origRegister.apply(null, arguments).then(wrapRegistration);
          };
        }
        console.log('[whats] serviceWorker showNotification interceptor installed');
        void origReady;
      }
    } catch (e) {
      console.warn('[whats] serviceWorker shim install failed', e);
    }
  }

  // --- external link opener ---
  // The webview swallows target="_blank" clicks and window.open() popups, so
  // outbound links never reach the user's default browser. Forward them to
  // the Rust shell via IPC instead.
  function isExternalUrl(href) {
    if (!href) return false;
    return /^(https?:|mailto:|tel:)/i.test(href);
  }

  function openExternal(url) {
    safeInvoke('open_external', { url: String(url) });
  }

  function findAnchorInPath(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    if (path) {
      for (let i = 0; i < path.length; i++) {
        const n = path[i];
        if (n && n.tagName === 'A' && n.getAttribute && n.getAttribute('href')) return n;
      }
    }
    const t = e.target;
    return t && t.closest ? t.closest('a[href]') : null;
  }

  function handleLinkEvent(e) {
    if (e.defaultPrevented) return;
    if (e.type === 'click' && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    if (e.type === 'auxclick' && e.button !== 1) return;
    const a = findAnchorInPath(e);
    if (!a) return;
    const href = a.getAttribute('href');
    if (!isExternalUrl(href)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openExternal(href);
  }

  function installLinkInterceptor() {
    window.addEventListener('click', handleLinkEvent, true);
    window.addEventListener('auxclick', handleLinkEvent, true);

    const origOpen = window.open;
    window.open = function (url) {
      if (isExternalUrl(url)) {
        openExternal(url);
        return null;
      }
      try { return origOpen.apply(window, arguments); } catch (_) { return null; }
    };
  }

  // --- disconnected detector ---
  const DISC_RE = /phone not connected|computer not connected|trouble connecting/i;

  let lastDisconnected = null;
  let checkScheduled = false;

  function checkDisconnected() {
    checkScheduled = false;
    const alerts = document.querySelectorAll('[role="alert"], [aria-live="polite"], [aria-live="assertive"]');
    let text = '';
    alerts.forEach(function (el) { text += el.textContent; });
    const isDisc = DISC_RE.test(text);
    if (isDisc !== lastDisconnected) {
      lastDisconnected = isDisc;
      safeInvoke('report_disconnected', { disconnected: isDisc });
    }
  }

  function scheduleCheck() {
    if (!checkScheduled) {
      checkScheduled = true;
      setTimeout(checkDisconnected, 1000);
    }
  }

  function watchDisconnected() {
    checkDisconnected();
    new MutationObserver(scheduleCheck).observe(document.body, {
      subtree: true,
      childList: true,
    });
    setInterval(checkDisconnected, 30000);
  }

  // bootstrap: run as soon as DOM is usable
  function boot() {
    installNotificationShim();
    installLinkInterceptor();
    watchTitle();
    watchDisconnected();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
