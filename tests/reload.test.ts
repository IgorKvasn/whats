import { describe, expect, it, vi } from 'vitest';
import {
  MAIN_URL,
  RETRY_DELAYS_MS,
  installAutoReload,
  retryDelayMs,
  shouldRetryLoad,
} from '../src/main/reload';

describe('shouldRetryLoad', () => {
  it('retries main-frame network failures', () => {
    expect(shouldRetryLoad({ errorCode: -106, isMainFrame: true })).toBe(true);
  });

  it('ignores aborted loads (normal navigations/redirects)', () => {
    expect(shouldRetryLoad({ errorCode: -3, isMainFrame: true })).toBe(false);
  });

  it('ignores sub-frame failures', () => {
    expect(shouldRetryLoad({ errorCode: -106, isMainFrame: false })).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('follows the backoff schedule then clamps to the last delay', () => {
    expect(retryDelayMs(0)).toBe(RETRY_DELAYS_MS[0]);
    expect(retryDelayMs(RETRY_DELAYS_MS.length - 1)).toBe(RETRY_DELAYS_MS.at(-1));
    expect(retryDelayMs(999)).toBe(RETRY_DELAYS_MS.at(-1));
  });
});

describe('installAutoReload', () => {
  function createWebContents() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const webContents = {
      loadURL: vi.fn(),
      on: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        listeners.set(eventName, handler);
        return webContents;
      }),
    };
    return { webContents, listeners };
  }

  function failMainFrame(listeners: Map<string, (...args: unknown[]) => void>) {
    listeners.get('did-fail-load')!({}, -106, 'ERR_INTERNET_DISCONNECTED', MAIN_URL, true);
  }

  it('reloads the main URL after a main-frame failure', () => {
    const { webContents, listeners } = createWebContents();
    const scheduleRetry = vi.fn((cb: () => void) => cb());
    installAutoReload(webContents, { scheduleRetry });

    failMainFrame(listeners);

    expect(webContents.loadURL).toHaveBeenCalledWith(MAIN_URL);
  });

  it('does not reload on aborted or sub-frame failures', () => {
    const { webContents, listeners } = createWebContents();
    const scheduleRetry = vi.fn((cb: () => void) => cb());
    installAutoReload(webContents, { scheduleRetry });

    listeners.get('did-fail-load')!({}, -3, 'ERR_ABORTED', MAIN_URL, true);
    listeners.get('did-fail-load')!({}, -106, 'ERR_INTERNET_DISCONNECTED', MAIN_URL, false);

    expect(scheduleRetry).not.toHaveBeenCalled();
    expect(webContents.loadURL).not.toHaveBeenCalled();
  });

  it('coalesces failures while a retry is already pending', () => {
    const { webContents, listeners } = createWebContents();
    const scheduled: Array<() => void> = [];
    const scheduleRetry = vi.fn((cb: () => void) => {
      scheduled.push(cb);
    });
    installAutoReload(webContents, { scheduleRetry });

    failMainFrame(listeners);
    failMainFrame(listeners);
    failMainFrame(listeners);

    expect(scheduleRetry).toHaveBeenCalledOnce();

    scheduled[0]();
    expect(webContents.loadURL).toHaveBeenCalledOnce();
  });

  it('backs off across successive failures and resets after a successful load', () => {
    const { webContents, listeners } = createWebContents();
    const delays: number[] = [];
    const scheduleRetry = vi.fn((cb: () => void, delay: number) => {
      delays.push(delay);
      cb();
    });
    installAutoReload(webContents, { scheduleRetry });

    failMainFrame(listeners);
    failMainFrame(listeners);
    expect(delays).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);

    listeners.get('did-finish-load')!();
    failMainFrame(listeners);
    expect(delays.at(-1)).toBe(RETRY_DELAYS_MS[0]);
  });

  it('reports status transitions to the UI', () => {
    const { webContents, listeners } = createWebContents();
    const statuses: string[] = [];
    const scheduleRetry = vi.fn((cb: () => void) => cb());
    installAutoReload(webContents, {
      scheduleRetry,
      onStatusChange: (s) => statuses.push(s),
    });

    failMainFrame(listeners);
    listeners.get('did-finish-load')!();

    expect(statuses).toEqual(['waiting', 'reconnecting', 'connected']);
  });

  it('reconnectNow loads immediately without touching a pending retry', () => {
    const { webContents, listeners } = createWebContents();
    const scheduled: Array<() => void> = [];
    const cancelRetry = vi.fn();
    const controller = installAutoReload(webContents, {
      scheduleRetry: (cb: () => void) => {
        scheduled.push(cb);
        return 'handle';
      },
      cancelRetry,
    });

    failMainFrame(listeners);
    expect(webContents.loadURL).not.toHaveBeenCalled();

    controller.reconnectNow();
    expect(webContents.loadURL).toHaveBeenCalledOnce();
    expect(cancelRetry).not.toHaveBeenCalled();

    // Failed manual attempt: the scheduled automatic retry still fires.
    scheduled[0]();
    expect(webContents.loadURL).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending retry once a load succeeds', () => {
    const { webContents, listeners } = createWebContents();
    const cancelRetry = vi.fn();
    installAutoReload(webContents, {
      scheduleRetry: () => 'handle',
      cancelRetry,
    });

    failMainFrame(listeners);
    listeners.get('did-finish-load')!();

    expect(cancelRetry).toHaveBeenCalledWith('handle');
  });
});
