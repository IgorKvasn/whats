import { ipcRenderer, webFrame } from 'electron';
import {
  parseUnread,
  shouldNotifyFromUnreadDelta,
  pickFallbackNotificationPayload,
} from './inject';

function safeIpcSend(channel: string, ...args: unknown[]): void {
  try {
    ipcRenderer.send(channel, ...args);
  } catch (err) {
    console.warn('[whats] ipc send failed:', channel, err);
  }
}

let lastUnread = -1;
let lastDirectNotificationAtMs = Number.NEGATIVE_INFINITY;

function pushTitle(): void {
  const n = parseUnread(document.title);
  const prev = lastUnread;
  if (n !== lastUnread) {
    lastUnread = n;
    safeIpcSend('whatsapp:unread', n);
    if (
      shouldNotifyFromUnreadDelta({
        previousUnread: prev,
        nextUnread: n,
        nowMs: Date.now(),
        lastDirectNotificationAtMs,
        dedupeWindowMs: 1500,
      })
    ) {
      const payload = pickFallbackNotificationPayload(document);
      if (payload) {
        safeIpcSend('whatsapp:notify', payload);
      }
    }
  }
}

function watchTitle(): void {
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

function installNotificationShim(): void {
  const shimCode = `
    (function() {
      function ShimNotification(title, options) {
        var body = options && typeof options.body === 'string' ? options.body : null;
        window.postMessage({ type: '__whats_notify', title: title, body: body }, '*');
        return { close: function() {} };
      }
      ShimNotification.permission = 'granted';
      ShimNotification.requestPermission = function(cb) {
        if (typeof cb === 'function') cb('granted');
        return Promise.resolve('granted');
      };
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: ShimNotification,
      });

      try {
        var swc = navigator.serviceWorker;
        if (swc) {
          function wrapReg(reg) {
            if (!reg || reg.__whatsPatched) return reg;
            var orig = reg.showNotification ? reg.showNotification.bind(reg) : null;
            reg.showNotification = function(title, options) {
              var body = options && typeof options.body === 'string' ? options.body : null;
              window.postMessage({ type: '__whats_notify', title: title, body: body }, '*');
              if (orig) { try { return orig(title, options); } catch(_) {} }
              return Promise.resolve();
            };
            reg.__whatsPatched = true;
            return reg;
          }
          if (swc.getRegistration) {
            var origGetReg = swc.getRegistration.bind(swc);
            swc.getRegistration = function() { return origGetReg.apply(null, arguments).then(wrapReg); };
          }
          if (swc.getRegistrations) {
            var origGetRegs = swc.getRegistrations.bind(swc);
            swc.getRegistrations = function() { return origGetRegs.apply(null, arguments).then(function(r) { return r.map(wrapReg); }); };
          }
          if (swc.ready && typeof swc.ready.then === 'function') {
            swc.ready.then(wrapReg).catch(function(){});
          }
          if (swc.register) {
            var origRegister = swc.register.bind(swc);
            swc.register = function() { return origRegister.apply(null, arguments).then(wrapReg); };
          }
        }
      } catch(e) {}
    })();
  `;

  webFrame.executeJavaScript(shimCode);

  window.addEventListener('message', (event) => {
    if (event.data?.type === '__whats_notify') {
      lastDirectNotificationAtMs = Date.now();
      safeIpcSend('whatsapp:notify', {
        sender: String(event.data.title || ''),
        body: event.data.body ?? null,
      });
    }
  });
}

function installLinkInterceptor(): void {
  document.addEventListener('click', handleLinkEvent, true);
  document.addEventListener('auxclick', handleLinkEvent, true);
}

function handleLinkEvent(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  if (e.type === 'click' && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))
    return;
  if (e.type === 'auxclick' && e.button !== 1) return;

  const a = findAnchorInPath(e);
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !isExternalUrl(href)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  safeIpcSend('shell:open-external', href);
}

function findAnchorInPath(e: Event): HTMLAnchorElement | null {
  const path = e.composedPath?.();
  if (path) {
    for (const node of path) {
      if (
        node instanceof HTMLElement &&
        node.tagName === 'A' &&
        node.getAttribute('href')
      ) {
        return node as HTMLAnchorElement;
      }
    }
  }
  const target = e.target as HTMLElement | null;
  return target?.closest?.('a[href]') ?? null;
}

function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

const DISC_RE = /phone not connected|computer not connected|trouble connecting/i;
let lastDisconnected: boolean | null = null;
let checkScheduled = false;

function checkDisconnected(): void {
  checkScheduled = false;
  const alerts = document.querySelectorAll(
    '[role="alert"], [aria-live="polite"], [aria-live="assertive"]',
  );
  let text = '';
  alerts.forEach((el) => {
    text += el.textContent;
  });
  const isDisc = DISC_RE.test(text);
  if (isDisc !== lastDisconnected) {
    lastDisconnected = isDisc;
    safeIpcSend('whatsapp:disconnected', isDisc);
  }
}

function scheduleCheck(): void {
  if (!checkScheduled) {
    checkScheduled = true;
    setTimeout(checkDisconnected, 1000);
  }
}

function watchDisconnected(): void {
  checkDisconnected();
  new MutationObserver(scheduleCheck).observe(document.body, {
    subtree: true,
    childList: true,
  });
  setInterval(checkDisconnected, 30000);
}

function boot(): void {
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
