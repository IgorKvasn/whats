import { describe, expect, it, vi } from 'vitest';

// @vitest-environment node

describe('notification startup loading', () => {
  it('loads D-Bus only when showing a notification', async () => {
    vi.resetModules();
    let dbusImportCount = 0;
    const mockNotify = vi.fn((...args) => {
      const callback = args.at(-1);
      callback(null, 42);
    });

    vi.doMock('@homebridge/dbus-native', () => {
      dbusImportCount += 1;

      const dbusNative = {
        sessionBus: () => ({
          connection: {
            once: vi.fn(),
            removeListener: vi.fn(),
          },
          getService: () => ({
            getInterface: vi.fn((_path, _iface, callback) => callback(null, {
              Notify: mockNotify,
              CloseNotification: vi.fn((_id, callback) => callback(null)),
              on: vi.fn(),
              removeListener: vi.fn(),
            })),
          }),
        }),
      };
      return {
        ...dbusNative,
        default: dbusNative,
      };
    });

    const { showNotification } = await import('../src/main/notifications');

    expect(dbusImportCount).toBe(0);

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());

    await vi.waitFor(() => {
      expect(dbusImportCount).toBe(1);
    });
    expect(mockNotify).toHaveBeenCalledWith(
      'WhatsApp',
      0,
      '/icons/icon.png',
      'Alice',
      'Hello',
      ['open', 'Open', 'dismiss', 'Dismiss'],
      [],
      -1,
      expect.any(Function),
    );

    vi.doUnmock('@homebridge/dbus-native');
  });
});
