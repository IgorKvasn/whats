import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
type NotificationClosedHandler = (notificationId: number, reason: number) => void;

type DbusNativeCallback<T = unknown> = (error: Error | null, value?: T) => void;

const {
  mockNotifyCall,
  mockOnSignal,
  mockRemoveListener,
  mockCloseNotification,
  mockGetInterface,
  mockSessionBus,
  connectionErrorHandlers,
} = vi.hoisted(() => {
  const mockNotifyCall = vi.fn<(...args: unknown[]) => void>();
  const mockOnSignal = vi.fn<(signal: string, handler: ActionInvokedHandler | NotificationClosedHandler) => void>();
  const mockRemoveListener = vi.fn();
  const mockCloseNotification = vi.fn<(id: number, callback: DbusNativeCallback<void>) => void>();
  const mockGetInterface = vi.fn();
  const mockSessionBus = vi.fn();
  const connectionErrorHandlers: Array<(error: Error) => void> = [];
  return {
    mockNotifyCall,
    mockOnSignal,
    mockRemoveListener,
    mockCloseNotification,
    mockGetInterface,
    mockSessionBus,
    connectionErrorHandlers,
  };
});

vi.mock('@homebridge/dbus-native', () => {
  const dbusNative = {
    sessionBus: () => {
      mockSessionBus();
      return {
        connection: {
          once: (_event: string, handler: (error: Error) => void) => {
            connectionErrorHandlers.push(handler);
          },
          removeListener: vi.fn(),
        },
        getService: () => ({
          getInterface: mockGetInterface,
        }),
      };
    },
  };
  return {
    ...dbusNative,
    default: dbusNative,
  };
});

const notificationsModule = import('../src/main/notifications');

beforeEach(async () => {
  mockExecFile.mockReset();
  mockNotifyCall.mockReset();
  mockOnSignal.mockReset();
  mockRemoveListener.mockReset();
  mockCloseNotification.mockReset();
  mockGetInterface.mockReset();
  mockSessionBus.mockReset();
  connectionErrorHandlers.length = 0;
  vi.unstubAllGlobals();

  const { resetNotificationState } = await notificationsModule;
  resetNotificationState();

  mockCloseNotification.mockImplementation((_id, callback) => callback(null));
  mockNotifyCall.mockImplementation((...args) => {
    const callback = args.at(-1) as DbusNativeCallback<number>;
    callback(null, 42);
  });
  mockGetInterface.mockImplementation((_path, _iface, callback: DbusNativeCallback) => {
    callback(null, {
      Notify: mockNotifyCall,
      CloseNotification: mockCloseNotification,
      on: mockOnSignal,
      removeListener: mockRemoveListener,
    });
  });
});

async function showNotificationWithId(
  notificationId: number,
  sender: string,
  cleanupIcon?: () => void,
): Promise<void> {
  const { showNotification } = await notificationsModule;
  const callsBefore = mockNotifyCall.mock.calls.length;

  mockNotifyCall.mockImplementationOnce((...args) => {
    const callback = args.at(-1) as DbusNativeCallback<number>;
    callback(null, notificationId);
  });
  showNotification(sender, 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/sender.png', cleanupIcon);
  await vi.waitFor(() => {
    expect(mockNotifyCall.mock.calls.length).toBe(callsBefore + 1);
  });
}

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
    expect(args[8]).toEqual(expect.any(Function));
  });

  it('uses bundled icon as app icon and sender icon file URI as D-Bus image hint', async () => {
    const { showNotification } = await notificationsModule;

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/alice.png');
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledOnce();
    });

    const args = mockNotifyCall.mock.calls[0];
    expect(args[2]).toBe('/icons/icon.png');
    expect(args[6]).toEqual([
      ['image-path', ['s', 'file:///tmp/alice.png']],
      ['image_path', ['s', 'file:///tmp/alice.png']],
    ]);
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

  it('removes sender icon after notification action is received', async () => {
    const { showNotification } = await notificationsModule;
    const removeIcon = vi.fn();

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/alice.png', removeIcon);
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalled();
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'ActionInvoked')![1] as ActionInvokedHandler;
    handler(42, 'dismiss');

    expect(removeIcon).toHaveBeenCalledOnce();
  });

  it('removes sender icon after notification is closed', async () => {
    const { showNotification } = await notificationsModule;
    const removeIcon = vi.fn();

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/alice.png', removeIcon);
    await vi.waitFor(() => {
      expect(mockOnSignal).toHaveBeenCalledWith('NotificationClosed', expect.any(Function));
    });

    const handler = mockOnSignal.mock.calls.find(c => c[0] === 'NotificationClosed')![1] as NotificationClosedHandler;
    handler(42, 2);

    expect(removeIcon).toHaveBeenCalledOnce();
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
    mockGetInterface.mockImplementation((_path, _iface, callback: DbusNativeCallback) => {
      callback(new Error('D-Bus unavailable'));
    });
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/alice.png');
    await vi.waitFor(() => {
      expect(mockExecFile).toHaveBeenCalled();
    });

    const notifySendCall = mockExecFile.mock.calls.find((c) => c[0] === 'notify-send');
    expect(notifySendCall).toBeDefined();
    const args = notifySendCall![1];
    expect(args).toEqual([
      '--app-name', 'WhatsApp',
      '--icon', '/tmp/alice.png',
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

describe('resolveNotificationIconPath', () => {
  it('caches data image icons as local files', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));

    try {
      const iconPath = await resolveNotificationIconPath(
        'data:image/png;base64,aGVsbG8=',
        '/icons/icon.png',
        cacheDir,
      );

      expect(iconPath.startsWith(cacheDir)).toBe(true);
      await expect(readFile(iconPath, 'utf8')).resolves.toBe('hello');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('falls back when icon candidate is unsupported', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;

    await expect(
      resolveNotificationIconPath('file:///tmp/alice.png', '/icons/icon.png', '/tmp/cache'),
    ).resolves.toBe('/icons/icon.png');
  });

  it('removes cached notification icon files', async () => {
    const { resolveNotificationIconPath, removeCachedNotificationIcon } = await notificationsModule;
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));

    try {
      const iconPath = await resolveNotificationIconPath(
        'data:image/png;base64,aGVsbG8=',
        '/icons/icon.png',
        cacheDir,
      );

      await removeCachedNotificationIcon(iconPath, '/icons/icon.png');

      await expect(readFile(iconPath)).rejects.toThrow();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('does not remove the fallback app icon', async () => {
    const { removeCachedNotificationIcon } = await notificationsModule;
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));
    const fallbackIconPath = path.join(cacheDir, 'icon.png');

    try {
      await writeFile(fallbackIconPath, 'app-icon');

      await removeCachedNotificationIcon(fallbackIconPath, fallbackIconPath);

      await expect(readFile(fallbackIconPath, 'utf8')).resolves.toBe('app-icon');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('closeAllNotifications', () => {
  it('calls CloseNotification for all active notifications', async () => {
    const { showNotification, closeAllNotifications } = await notificationsModule;

    mockNotifyCall.mockImplementationOnce((...args) => {
      const callback = args.at(-1) as DbusNativeCallback<number>;
      callback(null, 10);
    });
    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(1);
    });

    mockNotifyCall.mockImplementationOnce((...args) => {
      const callback = args.at(-1) as DbusNativeCallback<number>;
      callback(null, 11);
    });
    showNotification('Bob', 'Hey', false, '/icons/icon.png', vi.fn());
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(2);
    });

    closeAllNotifications();

    expect(mockCloseNotification).toHaveBeenCalledWith(10, expect.any(Function));
    expect(mockCloseNotification).toHaveBeenCalledWith(11, expect.any(Function));
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

  it('removes sender icons for all active notifications', async () => {
    const { showNotification, closeAllNotifications } = await notificationsModule;
    const removeFirstIcon = vi.fn();
    const removeSecondIcon = vi.fn();

    mockNotifyCall.mockImplementationOnce((...args) => {
      const callback = args.at(-1) as DbusNativeCallback<number>;
      callback(null, 10);
    });
    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn(), '/tmp/alice.png', removeFirstIcon);
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(1);
    });

    mockNotifyCall.mockImplementationOnce((...args) => {
      const callback = args.at(-1) as DbusNativeCallback<number>;
      callback(null, 11);
    });
    showNotification('Bob', 'Hey', false, '/icons/icon.png', vi.fn(), '/tmp/bob.png', removeSecondIcon);
    await vi.waitFor(() => {
      expect(mockNotifyCall).toHaveBeenCalledTimes(2);
    });

    closeAllNotifications();

    expect(removeFirstIcon).toHaveBeenCalledOnce();
    expect(removeSecondIcon).toHaveBeenCalledOnce();
  });
});

describe('isAllowedIconUrl', () => {
  it('accepts WhatsApp avatar hosts', async () => {
    const { isAllowedIconUrl } = await notificationsModule;
    expect(isAllowedIconUrl('https://pps.whatsapp.net/v/t61/avatar.jpg')).toBe(true);
    expect(isAllowedIconUrl('https://web.whatsapp.com/img/avatar.png')).toBe(true);
    expect(isAllowedIconUrl('https://mmg.cdn.whatsapp.net/avatar.jpg')).toBe(true);
    expect(isAllowedIconUrl('https://scontent.fbcdn.net/avatar.jpg')).toBe(true);
    expect(isAllowedIconUrl('HTTPS://PPS.WHATSAPP.NET/avatar.jpg')).toBe(true);
  });

  it('rejects host-local and private destinations', async () => {
    const { isAllowedIconUrl } = await notificationsModule;
    expect(isAllowedIconUrl('https://127.0.0.1/secret')).toBe(false);
    expect(isAllowedIconUrl('https://localhost/secret')).toBe(false);
    expect(isAllowedIconUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedIconUrl('https://192.168.1.1/admin')).toBe(false);
    expect(isAllowedIconUrl('https://10.0.0.5/admin')).toBe(false);
    expect(isAllowedIconUrl('https://[::1]/secret')).toBe(false);
  });

  it('rejects hosts that only look like allowlisted ones', async () => {
    const { isAllowedIconUrl } = await notificationsModule;
    expect(isAllowedIconUrl('https://evil-fbcdn.net/avatar.jpg')).toBe(false);
    expect(isAllowedIconUrl('https://pps.whatsapp.net.evil.example/avatar.jpg')).toBe(false);
    expect(isAllowedIconUrl('https://evil.example/?x=pps.whatsapp.net')).toBe(false);
    expect(isAllowedIconUrl('https://pps.whatsapp.net@evil.example/avatar.jpg')).toBe(false);
  });

  it('rejects non-https schemes, credentials and non-default ports', async () => {
    const { isAllowedIconUrl } = await notificationsModule;
    expect(isAllowedIconUrl('http://pps.whatsapp.net/avatar.jpg')).toBe(false);
    expect(isAllowedIconUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedIconUrl('https://user:pass@pps.whatsapp.net/avatar.jpg')).toBe(false);
    expect(isAllowedIconUrl('https://pps.whatsapp.net:8443/avatar.jpg')).toBe(false);
    expect(isAllowedIconUrl('not-a-url')).toBe(false);
    expect(isAllowedIconUrl('')).toBe(false);
  });
});

describe('resolveNotificationIconPath remote fetches', () => {
  function imageResponse(url: string): Response {
    return {
      ok: true,
      url,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': '5' }),
      arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
    } as unknown as Response;
  }

  it('fetches allowlisted icon hosts with redirects refused', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const iconUrl = 'https://pps.whatsapp.net/v/t61/alice.png';
    const mockFetch = vi.fn(async () => imageResponse(iconUrl));
    vi.stubGlobal('fetch', mockFetch);
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));

    try {
      const iconPath = await resolveNotificationIconPath(iconUrl, '/icons/icon.png', cacheDir);

      expect(iconPath.startsWith(cacheDir)).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
      await expect(readFile(iconPath, 'utf8')).resolves.toBe('hello');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('never fetches a non-allowlisted host', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      resolveNotificationIconPath('https://169.254.169.254/latest/', '/icons/icon.png', '/tmp/cache'),
    ).resolves.toBe('/icons/icon.png');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back when a refused redirect makes fetch throw', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const mockFetch = vi.fn(async () => {
      throw new TypeError('unexpected redirect, redirect mode is set to error');
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      resolveNotificationIconPath('https://pps.whatsapp.net/alice.png', '/icons/icon.png', '/tmp/cache'),
    ).resolves.toBe('/icons/icon.png');
  });

  it('falls back when the final response URL left the allowlist', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const mockFetch = vi.fn(async () => imageResponse('http://169.254.169.254/latest/'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      resolveNotificationIconPath('https://pps.whatsapp.net/alice.png', '/icons/icon.png', '/tmp/cache'),
    ).resolves.toBe('/icons/icon.png');
  });
});

describe('sweepNotificationIconCache', () => {
  async function fillCache(cacheDir: string, prefix: string, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const filePath = path.join(cacheDir, `${prefix}-${String(index).padStart(3, '0')}.png`);
      await writeFile(filePath, 'x');
      await utimes(filePath, new Date(index * 1000), new Date(index * 1000));
    }
  }

  it('evicts oldest icons once the file count bound is exceeded', async () => {
    const { sweepNotificationIconCache } = await notificationsModule;
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));

    try {
      await fillCache(cacheDir, 'icon', 140);

      await sweepNotificationIconCache(cacheDir);

      const remaining = (await readdir(cacheDir)).sort();
      expect(remaining).toHaveLength(128);
      expect(remaining[0]).toBe('icon-012.png');
      expect(remaining.at(-1)).toBe('icon-139.png');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('bounds the cache when writing an icon and keeps the new file', async () => {
    const { resolveNotificationIconPath } = await notificationsModule;
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'whats-icons-'));

    try {
      await fillCache(cacheDir, 'stale', 200);

      const iconPath = await resolveNotificationIconPath(
        'data:image/png;base64,aGVsbG8=',
        '/icons/icon.png',
        cacheDir,
      );

      expect(await readdir(cacheDir)).toHaveLength(128);
      await expect(readFile(iconPath, 'utf8')).resolves.toBe('hello');
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('ignores a cache directory that does not exist', async () => {
    const { sweepNotificationIconCache } = await notificationsModule;

    await expect(
      sweepNotificationIconCache(path.join(os.tmpdir(), 'whats-icons-missing-dir')),
    ).resolves.toBeUndefined();
  });
});

describe('D-Bus session bus reuse', () => {
  it('reuses a single session bus across notifications', async () => {
    await showNotificationWithId(10, 'Alice');
    await showNotificationWithId(11, 'Bob');

    expect(mockSessionBus).toHaveBeenCalledOnce();
  });

  it('closes every active notification on the bus that issued its id', async () => {
    const { closeAllNotifications } = await notificationsModule;
    const closedPerInterface: Array<{ iface: number; id: number }> = [];
    let interfaceCount = 0;

    mockGetInterface.mockImplementation((_path, _iface, callback: DbusNativeCallback) => {
      interfaceCount += 1;
      const ifaceIndex = interfaceCount;
      callback(null, {
        Notify: mockNotifyCall,
        CloseNotification: (id: number) => closedPerInterface.push({ iface: ifaceIndex, id }),
        on: mockOnSignal,
        removeListener: mockRemoveListener,
      });
    });

    await showNotificationWithId(10, 'Alice');
    await showNotificationWithId(11, 'Bob');

    closeAllNotifications();

    expect(closedPerInterface).toEqual([
      { iface: 1, id: 10 },
      { iface: 1, id: 11 },
    ]);
  });

  it('reconnects after the cached connection errors', async () => {
    await showNotificationWithId(10, 'Alice');
    expect(mockSessionBus).toHaveBeenCalledOnce();

    connectionErrorHandlers.forEach((handler) => handler(new Error('connection lost')));

    await showNotificationWithId(11, 'Bob');
    expect(mockSessionBus).toHaveBeenCalledTimes(2);
  });

  it('runs pending icon cleanups exactly once when the connection drops', async () => {
    const { closeAllNotifications } = await notificationsModule;
    const cleanupIcon = vi.fn();

    await showNotificationWithId(10, 'Alice', cleanupIcon);
    connectionErrorHandlers.forEach((handler) => handler(new Error('connection lost')));

    expect(cleanupIcon).toHaveBeenCalledOnce();

    closeAllNotifications();
    expect(cleanupIcon).toHaveBeenCalledOnce();
  });
});
