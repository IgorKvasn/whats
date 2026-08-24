import { describe, expect, it, vi, beforeEach } from 'vitest';

// @vitest-environment node

const { mockShowNotification } = vi.hoisted(() => {
  return { mockShowNotification: vi.fn() };
});

vi.mock('../src/main/notifications', () => ({
  showNotification: mockShowNotification,
}));

import { notifyDownloadFailed } from '../src/main/downloadNotifications';
import { installDownloadObserver, type DownloadOutcome } from '../src/main/downloads';

function createDownloadItem(filename: string) {
  return { getFilename: vi.fn(() => filename) } as never;
}

beforeEach(() => {
  mockShowNotification.mockReset();
});

describe('notifyDownloadFailed', () => {
  it('shows a notification when notifications are enabled', () => {
    const item = createDownloadItem('report.pdf');
    const onOpen = vi.fn();

    notifyDownloadFailed(item, { notificationsEnabled: true }, '/icon.png', onOpen);

    expect(mockShowNotification).toHaveBeenCalledTimes(1);
    const [sender, body, withSound, iconPath, notifiedOnOpen] = mockShowNotification.mock.calls[0];
    expect(sender).toBe('WhatsApp');
    expect(body).toContain('report.pdf');
    expect(withSound).toBe(false);
    expect(iconPath).toBe('/icon.png');
    expect(notifiedOnOpen).toBe(onOpen);
  });

  it('does not show a notification when notifications are disabled', () => {
    const item = createDownloadItem('report.pdf');

    notifyDownloadFailed(item, { notificationsEnabled: false }, '/icon.png', vi.fn());

    expect(mockShowNotification).not.toHaveBeenCalled();
  });
});

describe('onOutcome wiring (as used in index.ts)', () => {
  function createSession() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const session = {
      on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        listeners.set(eventName, handler);
        return session;
      }),
    };
    return { session, listeners };
  }

  function createFiringItem(filename: string) {
    const doneListeners: Array<(...args: unknown[]) => void> = [];
    const item = {
      getFilename: vi.fn(() => filename),
      once: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        if (eventName === 'done') doneListeners.push(handler);
        return item;
      }),
    };
    return {
      item,
      fireDone: (state: DownloadOutcome) => {
        for (const handler of doneListeners) handler({}, state);
      },
    };
  }

  function installObserverWithNotificationWiring() {
    const { session, listeners } = createSession();
    installDownloadObserver(session as never, {
      onOutcome: (item, outcome) => {
        if (outcome === 'interrupted') {
          notifyDownloadFailed(item, { notificationsEnabled: true }, '/icon.png', vi.fn());
        }
      },
    });
    return { listeners };
  }

  it('notifies for an interrupted download', () => {
    const { listeners } = installObserverWithNotificationWiring();
    const { item, fireDone } = createFiringItem('file.pdf');
    listeners.get('will-download')!({}, item as never);
    fireDone('interrupted');

    expect(mockShowNotification).toHaveBeenCalledTimes(1);
  });

  it('does not notify for a cancelled download', () => {
    const { listeners } = installObserverWithNotificationWiring();
    const { item, fireDone } = createFiringItem('file.pdf');
    listeners.get('will-download')!({}, item as never);
    fireDone('cancelled');

    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  it('does not notify for a completed download', () => {
    const { listeners } = installObserverWithNotificationWiring();
    const { item, fireDone } = createFiringItem('file.pdf');
    listeners.get('will-download')!({}, item as never);
    fireDone('completed');

    expect(mockShowNotification).not.toHaveBeenCalled();
  });
});
