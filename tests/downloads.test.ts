import { describe, expect, it, vi } from 'vitest';
import { installDownloadObserver } from '../src/main/downloads';

// @vitest-environment node

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

function createDownloadItem(filename: string) {
  const doneListeners: Array<(...args: unknown[]) => void> = [];
  const item = {
    getFilename: vi.fn(() => filename),
    once: vi.fn((eventName: string, handler: (...args: unknown[]) => void) => {
      if (eventName === 'done') doneListeners.push(handler);
      return item;
    }),
  };
  return { item, fireDone: (state: 'completed' | 'cancelled' | 'interrupted') => {
    for (const handler of doneListeners) handler({}, state);
  } };
}

describe('installDownloadObserver', () => {
  it('reports a completed download', () => {
    const { session, listeners } = createSession();
    const onOutcome = vi.fn();
    installDownloadObserver(session as never, { onOutcome });

    const { item, fireDone } = createDownloadItem('file.pdf');
    listeners.get('will-download')!({}, item);
    fireDone('completed');

    expect(onOutcome).toHaveBeenCalledWith(item, 'completed');
  });

  it('reports a cancelled download distinctly from an error', () => {
    const { session, listeners } = createSession();
    const onOutcome = vi.fn();
    installDownloadObserver(session as never, { onOutcome });

    const { item, fireDone } = createDownloadItem('file.pdf');
    listeners.get('will-download')!({}, item);
    fireDone('cancelled');

    expect(onOutcome).toHaveBeenCalledWith(item, 'cancelled');
  });

  it('reports an interrupted download distinctly from a user cancel', () => {
    const { session, listeners } = createSession();
    const onOutcome = vi.fn();
    installDownloadObserver(session as never, { onOutcome });

    const { item, fireDone } = createDownloadItem('file.pdf');
    listeners.get('will-download')!({}, item);
    fireDone('interrupted');

    expect(onOutcome).toHaveBeenCalledWith(item, 'interrupted');
  });

  it('does not intercept the save path', () => {
    const { session, listeners } = createSession();
    installDownloadObserver(session as never, { onOutcome: vi.fn() });

    const { item } = createDownloadItem('file.pdf');
    listeners.get('will-download')!({}, item);

    expect((item as Record<string, unknown>).setSavePath).toBeUndefined();
  });
});
