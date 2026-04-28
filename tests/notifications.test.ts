import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';

// @vitest-environment node

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

const { mockExecFile } = vi.hoisted(() => {
  return {
    mockExecFile: vi.fn<(cmd: string, args: string[], cb: ExecFileCallback) => void>(),
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

type ActionInvokedHandler = (notificationId: number, actionKey: string) => void;

const { mockNotifyCall, mockOnSignal, mockRemoveListener, mockCloseNotification, mockGetProxyObject } = vi.hoisted(() => {
  const mockNotifyCall = vi.fn<(...args: unknown[]) => Promise<number>>();
  const mockOnSignal = vi.fn<(signal: string, handler: ActionInvokedHandler) => void>();
  const mockRemoveListener = vi.fn();
  const mockCloseNotification = vi.fn<(id: number) => Promise<void>>();
  const mockGetProxyObject = vi.fn();
  return { mockNotifyCall, mockOnSignal, mockRemoveListener, mockCloseNotification, mockGetProxyObject };
});

vi.mock('dbus-next', () => {
  return {
    sessionBus: () => ({
      getProxyObject: mockGetProxyObject,
      disconnect: vi.fn(),
    }),
  };
});

const notificationsModule = import('../src/main/notifications');

beforeEach(async () => {
  mockExecFile.mockReset();
  mockNotifyCall.mockReset();
  mockOnSignal.mockReset();
  mockRemoveListener.mockReset();
  mockCloseNotification.mockReset();
  mockGetProxyObject.mockReset();

  const { resetNotificationState } = await notificationsModule;
  resetNotificationState();

  mockCloseNotification.mockResolvedValue(undefined);
  mockNotifyCall.mockResolvedValue(42);
  mockGetProxyObject.mockResolvedValue({
    getInterface: () => ({
      Notify: mockNotifyCall,
      CloseNotification: mockCloseNotification,
      on: mockOnSignal,
      removeListener: mockRemoveListener,
    }),
  });
});

describe('shouldDispatch', () => {
  it('dispatches on first call (no previous notification)', async () => {
    const { shouldDispatch } = await notificationsModule;
    expect(shouldDispatch(null, Date.now(), 'Alice', 'hi', 1500)).toBe(true);
  });

  it('skips same payload within dedup window', async () => {
    const { shouldDispatch } = await notificationsModule;
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(false);
  });

  it('dispatches same payload after dedup window', async () => {
    const { shouldDispatch } = await notificationsModule;
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 2000;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(true);
  });

  it('dispatches different payload within dedup window', async () => {
    const { shouldDispatch } = await notificationsModule;
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Bob', 'hello', 1500)).toBe(true);
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts web and contact schemes', async () => {
    const { isSafeExternalUrl } = await notificationsModule;
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('HTTP://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeExternalUrl('tel:+1234')).toBe(true);
  });

  it('rejects dangerous schemes', async () => {
    const { isSafeExternalUrl } = await notificationsModule;
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('ssh://host')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });
});

describe('showNotification', () => {
  it('calls D-Bus Notify with correct arguments including actions', async () => {
    const { showNotification } = await notificationsModule;

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledOnce();
    });

    const args = mockNotifyCall.mock.calls[0];
    expect(args[0]).toBe('WhatsApp');       // app_name
    expect(args[1]).toBe(0);                // replaces_id
    expect(args[2]).toBe('/icons/icon.png'); // icon
    expect(args[3]).toBe('Alice');           // summary
    expect(args[4]).toBe('Hello');           // body
    expect(args[5]).toEqual(['open', 'Open', 'dismiss', 'Dismiss']); // actions
    expect(args[7]).toBe(-1);               // timeout
  });

  it('calls onOpen when ActionInvoked fires with "open"', async () => {
    const { showNotification } = await notificationsModule;
    const onOpen = vi.fn();

    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1];
    handler(42, 'open');
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not call onOpen when ActionInvoked fires with "dismiss"', async () => {
    const { showNotification } = await notificationsModule;
    const onOpen = vi.fn();

    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1];
    handler(42, 'dismiss');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('cleans up ActionInvoked listener after action is received', async () => {
    const { showNotification } = await notificationsModule;

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1];
    handler(42, 'open');
    expect(mockRemoveListener).toHaveBeenCalledWith('ActionInvoked', handler);
  });

  it('ignores ActionInvoked for different notification IDs', async () => {
    const { showNotification } = await notificationsModule;
    const onOpen = vi.fn();

    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1];
    handler(999, 'open');
    expect(onOpen).not.toHaveBeenCalled();
    expect(mockRemoveListener).not.toHaveBeenCalled();
  });

  it('falls back to notify-send without actions when D-Bus fails', async () => {
    mockGetProxyObject.mockRejectedValue(new Error('D-Bus unavailable'));
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockExecFile).toHaveBeenCalled();
    });

    const notifySendCall = mockExecFile.mock.calls.find((c) => c[0] === 'notify-send');
    expect(notifySendCall).toBeDefined();
    const args = notifySendCall![1];
    expect(args).toEqual([
      '--app-name', 'WhatsApp',
      '--icon', '/icons/icon.png',
      '--', 'Alice', 'Hello',
    ]);
  });

  it('plays sound when withSound is true', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', true, '/icons/icon.png', vi.fn());

    const paplayCall = mockExecFile.mock.calls.find((c) => c[0] === 'paplay');
    expect(paplayCall).toBeDefined();
    expect(paplayCall![1]).toEqual(['/usr/share/sounds/freedesktop/stereo/message-new-instant.oga']);
  });

  it('does not play sound when withSound is false', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());

    const paplayCall = mockExecFile.mock.calls.find((c) => c[0] === 'paplay');
    expect(paplayCall).toBeUndefined();
  });
});

describe('closeAllNotifications', () => {
  it('calls CloseNotification for all active notifications', async () => {
    const { showNotification, closeAllNotifications } = await notificationsModule;

    mockNotifyCall.mockResolvedValueOnce(10);
    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(1);
    });

    mockNotifyCall.mockResolvedValueOnce(11);
    showNotification('Bob', 'Hey', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(2);
    });

    closeAllNotifications();

    expect(mockCloseNotification).toHaveBeenCalledWith(10);
    expect(mockCloseNotification).toHaveBeenCalledWith(11);
    expect(mockCloseNotification).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no notifications are active', async () => {
    const { closeAllNotifications } = await notificationsModule;

    closeAllNotifications();

    expect(mockCloseNotification).not.toHaveBeenCalled();
  });

  it('removes notification from active set when action is invoked', async () => {
    const { showNotification, closeAllNotifications } = await notificationsModule;

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1];
    handler(42, 'open');

    closeAllNotifications();

    expect(mockCloseNotification).not.toHaveBeenCalled();
  });
});
