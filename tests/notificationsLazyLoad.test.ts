import { describe, expect, it, vi } from 'vitest';

// @vitest-environment node

describe('notification startup loading', () => {
  it('loads D-Bus only when showing a notification', async () => {
    vi.resetModules();
    let dbusImportCount = 0;
    const mockNotify = vi.fn().mockResolvedValue(42);

    vi.doMock('dbus-next', () => {
      dbusImportCount += 1;

      return {
        Variant: class MockVariant {
          signature: string;
          value: unknown;

          constructor(signature: string, value: unknown) {
            this.signature = signature;
            this.value = value;
          }
        },
        sessionBus: () => ({
          getProxyObject: vi.fn().mockResolvedValue({
            getInterface: () => ({
              Notify: mockNotify,
              CloseNotification: vi.fn().mockResolvedValue(undefined),
              on: vi.fn(),
              removeListener: vi.fn(),
            }),
          }),
          disconnect: vi.fn(),
        }),
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
      {},
      -1,
    );

    vi.doUnmock('dbus-next');
  });
});
