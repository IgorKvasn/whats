import { describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent } from 'electron';
import {
  createWhatsappIpcHandlers,
  NOTIFICATION_DEDUPE_MS,
  type WhatsappIpcDependencies,
} from '../src/main/whatsappIpc';
import { shouldDispatch } from '../src/main/notifications';
import { shouldShowIncomingNotification } from '../src/main/notificationPolicy';
import { defaultSettings, type Settings } from '../src/main/settings';

const trustedEvent = { trusted: true } as unknown as IpcMainEvent;
const untrustedEvent = { trusted: false } as unknown as IpcMainEvent;

function setup(overrides: Partial<WhatsappIpcDependencies> = {}, settings?: Partial<Settings>) {
  const currentSettings: Settings = { ...defaultSettings(), notificationsEnabled: true, ...settings };
  let clock = 1_000_000;

  const deps: WhatsappIpcDependencies = {
    isTrustedEvent: vi.fn((event: IpcMainEvent) => event === trustedEvent),
    getSettings: () => currentSettings,
    mainInForeground: () => false,
    shouldShowIncomingNotification,
    shouldDispatch,
    now: () => clock,
    resolveNotificationIconPath: vi.fn(async () => '/icons/sender.png'),
    removeCachedNotificationIcon: vi.fn(),
    showNotification: vi.fn(),
    updateUnread: vi.fn(),
    updateDisconnected: vi.fn(),
    isSafeExternalUrl: vi.fn(() => true),
    openExternal: vi.fn(),
    ...overrides,
  };

  return {
    handlers: createWhatsappIpcHandlers(deps),
    deps,
    settings: currentSettings,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('whatsapp ipc trust gate', () => {
  it('ignores notify from an untrusted sender', async () => {
    const { handlers, deps } = setup();

    await handlers.notify(untrustedEvent, { sender: 'Eve', body: 'hi' });

    expect(deps.showNotification).not.toHaveBeenCalled();
    expect(deps.resolveNotificationIconPath).not.toHaveBeenCalled();
  });

  it('ignores unread from an untrusted sender', () => {
    const { handlers, deps } = setup();

    handlers.unread(untrustedEvent, 5);

    expect(deps.updateUnread).not.toHaveBeenCalled();
  });

  it('ignores disconnected from an untrusted sender', () => {
    const { handlers, deps } = setup();

    handlers.disconnected(untrustedEvent, true);

    expect(deps.updateDisconnected).not.toHaveBeenCalled();
  });

  it('ignores open-external from an untrusted sender', () => {
    const { handlers, deps } = setup();

    handlers.openExternal(untrustedEvent, 'https://example.com/');

    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.isSafeExternalUrl).not.toHaveBeenCalled();
  });

  it('forwards trusted events to their side effects', async () => {
    const { handlers, deps } = setup();

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });
    handlers.unread(trustedEvent, 3);
    handlers.disconnected(trustedEvent, true);
    handlers.openExternal(trustedEvent, 'https://example.com/');

    expect(deps.showNotification).toHaveBeenCalledOnce();
    expect(deps.updateUnread).toHaveBeenCalledWith(3);
    expect(deps.updateDisconnected).toHaveBeenCalledWith(true);
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('does not open an unsafe external url', () => {
    const { handlers, deps } = setup({ isSafeExternalUrl: vi.fn(() => false) });

    handlers.openExternal(trustedEvent, 'file:///etc/passwd');

    expect(deps.openExternal).not.toHaveBeenCalled();
  });
});

describe('whatsapp notify payload handling', () => {
  it('truncates sender to 200 chars and body to 1000 chars', async () => {
    const { handlers, deps } = setup({}, { includePreview: true });

    await handlers.notify(trustedEvent, { sender: 'a'.repeat(500), body: 'b'.repeat(5000) });

    expect(deps.showNotification).toHaveBeenCalledOnce();
    const call = vi.mocked(deps.showNotification).mock.calls[0][0];
    expect(call.sender).toBe('a'.repeat(200));
    expect(call.body).toBe('b'.repeat(1000));
  });

  it('suppresses the body text when includePreview is false', async () => {
    const { handlers, deps } = setup({}, { includePreview: false });

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'secret' });

    const call = vi.mocked(deps.showNotification).mock.calls[0][0];
    expect(call.body).toBe('');
  });

  it('shows nothing when notifications are disabled', async () => {
    const { handlers, deps } = setup({}, { notificationsEnabled: false });

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });

    expect(deps.showNotification).not.toHaveBeenCalled();
  });

  it('shows nothing when the main window is in the foreground', async () => {
    const { handlers, deps } = setup({ mainInForeground: () => true });

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });

    expect(deps.showNotification).not.toHaveBeenCalled();
  });

  it('passes the resolved sender icon and a cleanup callback', async () => {
    const { handlers, deps } = setup();

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi', icon: 'data:image/png;base64,x' });

    expect(deps.resolveNotificationIconPath).toHaveBeenCalledWith('data:image/png;base64,x');
    const call = vi.mocked(deps.showNotification).mock.calls[0][0];
    expect(call.senderIconPath).toBe('/icons/sender.png');
    call.onClosed();
    expect(deps.removeCachedNotificationIcon).toHaveBeenCalledWith('/icons/sender.png');
  });
});

describe('whatsapp notify dedupe window', () => {
  it('drops an identical notification inside the dedupe window', async () => {
    const { handlers, deps, advance } = setup();

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });
    advance(NOTIFICATION_DEDUPE_MS - 1);
    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });

    expect(deps.showNotification).toHaveBeenCalledOnce();
  });

  it('allows an identical notification once the dedupe window elapses', async () => {
    const { handlers, deps, advance } = setup();

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });
    advance(NOTIFICATION_DEDUPE_MS);
    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });

    expect(deps.showNotification).toHaveBeenCalledTimes(2);
  });

  it('allows a different message inside the dedupe window', async () => {
    const { handlers, deps, advance } = setup();

    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'hi' });
    advance(10);
    await handlers.notify(trustedEvent, { sender: 'Alice', body: 'there' });

    expect(deps.showNotification).toHaveBeenCalledTimes(2);
  });

  it('dedupes on the truncated payload, not the raw one', async () => {
    const { handlers, deps, advance } = setup();

    await handlers.notify(trustedEvent, { sender: 'a'.repeat(200) + 'x', body: null });
    advance(10);
    await handlers.notify(trustedEvent, { sender: 'a'.repeat(200) + 'y', body: null });

    expect(deps.showNotification).toHaveBeenCalledOnce();
  });
});
