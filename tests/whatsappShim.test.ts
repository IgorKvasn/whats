import { describe, it, expect, beforeEach, vi } from 'vitest';

const ipcSend = vi.fn();
const executeJavaScript = vi.fn();

vi.mock('electron', () => ({
  ipcRenderer: { send: (...args: unknown[]) => ipcSend(...args) },
  webFrame: { executeJavaScript: (code: string) => executeJavaScript(code) },
}));

async function loadPreload(): Promise<{ NOTIFICATION_SHIM_SOURCE: string }> {
  return import('../src/preload/whatsapp');
}

// jsdom leaves event.source null for postMessage issued from a `new Function` scope, so the
// shim's messages would be rejected by the preload's same-window guard. Stay patched for the
// lifetime of the shim and redispatch with source set, matching what a real browser reports
// for a same-window post.
function runShim(source: string): void {
  window.postMessage = ((data: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
  }) as typeof window.postMessage;
  new Function(source)();
}

function flushMessages(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Each module instance attaches a MutationObserver to the current <title>; replacing the
// element detaches observers left over from previously imported instances.
function resetTitle(title: string): void {
  document.head.querySelector('title')?.remove();
  const titleEl = document.createElement('title');
  titleEl.textContent = title;
  document.head.appendChild(titleEl);
}

type NotificationCtor = new (title: string, options?: object) => unknown;

function shimmedNotification(): NotificationCtor & {
  permission: string;
  requestPermission: () => Promise<string>;
} {
  return (window as unknown as {
    Notification: NotificationCtor & {
      permission: string;
      requestPermission: () => Promise<string>;
    };
  }).Notification;
}

function collectMessages(): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  window.addEventListener('message', (event) => messages.push(event.data));
  return messages;
}

describe('injected notification shim', () => {
  let shimSource: string;

  beforeEach(async () => {
    ipcSend.mockClear();
    executeJavaScript.mockClear();
    resetTitle('WhatsApp');
    vi.resetModules();
    shimSource = (await loadPreload()).NOTIFICATION_SHIM_SOURCE;
  });

  it('is the source handed to executeJavaScript', () => {
    expect(executeJavaScript).toHaveBeenCalledWith(shimSource);
  });

  it('posts __whats_notify with title, body and icon', async () => {
    runShim(shimSource);
    const messages = collectMessages();

    new (shimmedNotification())('Alice', { body: 'hi', icon: 'https://example.test/alice.png' });

    await flushMessages();
    expect(messages).toContainEqual({
      type: '__whats_notify',
      title: 'Alice',
      body: 'hi',
      icon: 'https://example.test/alice.png',
    });
  });

  it('falls back to image then badge for the icon, and null body', async () => {
    runShim(shimSource);
    const messages = collectMessages();

    const Shim = shimmedNotification();
    new Shim('Bob', { image: 'image.png', badge: 'badge.png' });
    new Shim('Carol', { badge: 'badge.png' });
    new Shim('Dana');

    await flushMessages();
    expect(messages.map((m) => [m.title, m.body, m.icon])).toEqual([
      ['Bob', null, 'image.png'],
      ['Carol', null, 'badge.png'],
      ['Dana', null, null],
    ]);
  });

  it('reports permission as granted', async () => {
    runShim(shimSource);
    const Shim = shimmedNotification();
    expect(Shim.permission).toBe('granted');
    await expect(Shim.requestPermission()).resolves.toBe('granted');
  });

  it('patches a service worker registration to mirror showNotification', async () => {
    const originalShowNotification = vi.fn(() => Promise.resolve());
    const registration = { showNotification: originalShowNotification };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.resolve(registration) },
    });

    runShim(shimSource);
    const messages = collectMessages();

    const patched = await (
      navigator as unknown as {
        serviceWorker: { getRegistration: () => Promise<typeof registration> };
      }
    ).serviceWorker.getRegistration();
    await patched.showNotification('Erin', { body: 'sw message' });

    await flushMessages();
    expect(messages).toContainEqual({
      type: '__whats_notify',
      title: 'Erin',
      body: 'sw message',
      icon: null,
    });
    expect(originalShowNotification).toHaveBeenCalledWith('Erin', { body: 'sw message' });
  });
});

describe('preload message bridge', () => {
  beforeEach(() => {
    ipcSend.mockClear();
    resetTitle('WhatsApp');
    vi.resetModules();
  });

  it('forwards __whats_notify messages to the whatsapp:notify channel', async () => {
    const { NOTIFICATION_SHIM_SOURCE } = await loadPreload();
    runShim(NOTIFICATION_SHIM_SOURCE);

    new (shimmedNotification())('Alice', { body: 'hi', icon: 'alice.png' });

    await flushMessages();
    expect(ipcSend).toHaveBeenCalledWith('whatsapp:notify', {
      sender: 'Alice',
      body: 'hi',
      icon: 'alice.png',
    });
  });

  it('ignores unrelated window messages', async () => {
    await loadPreload();
    ipcSend.mockClear();

    window.postMessage({ type: 'something-else', title: 'Alice' }, '*');
    await flushMessages();

    expect(ipcSend).not.toHaveBeenCalledWith('whatsapp:notify', expect.anything());
  });

  it('ignores __whats_notify messages forged by an embedded frame', async () => {
    await loadPreload();
    ipcSend.mockClear();

    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: '__whats_notify', title: 'Attacker', body: 'forged', icon: null },
        source: frame.contentWindow,
      }),
    );
    await flushMessages();
    frame.remove();

    expect(ipcSend).not.toHaveBeenCalledWith('whatsapp:notify', expect.anything());
  });
});

describe('unread title observer', () => {
  beforeEach(() => {
    ipcSend.mockClear();
    resetTitle('WhatsApp');
    vi.resetModules();
  });

  it('reports the initial unread count on boot', async () => {
    resetTitle('(4) WhatsApp');
    await loadPreload();
    expect(ipcSend).toHaveBeenCalledWith('whatsapp:unread', 4);
  });

  it('reports counts when the title changes and skips repeats', async () => {
    await loadPreload();
    ipcSend.mockClear();

    document.title = '(2) WhatsApp';
    await flushMessages();
    document.title = '(2) WhatsApp';
    await flushMessages();
    document.title = 'WhatsApp';
    await flushMessages();

    const unreadCalls = ipcSend.mock.calls.filter(([channel]) => channel === 'whatsapp:unread');
    expect(unreadCalls).toEqual([
      ['whatsapp:unread', 2],
      ['whatsapp:unread', 0],
    ]);
  });
});
