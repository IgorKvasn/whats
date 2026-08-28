import { describe, expect, it, vi, beforeEach } from 'vitest';

// @vitest-environment node

const { MockBrowserWindow, overlays, parent } = vi.hoisted(() => {
  interface FakeWindow {
    handlers: Map<string, (...args: unknown[]) => void>;
    setBounds: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }

  const overlays: FakeWindow[] = [];

  const parentHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const parent = {
    handlers: parentHandlers,
    isDestroyed: vi.fn(() => false),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = parentHandlers.get(event) ?? [];
      existing.push(handler);
      parentHandlers.set(event, existing);
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = parentHandlers.get(event) ?? [];
      const index = existing.indexOf(handler);
      if (index !== -1) existing.splice(index, 1);
    }),
    emit: (event: string) => {
      for (const handler of [...(parentHandlers.get(event) ?? [])]) handler();
    },
  };

  const MockBrowserWindow = vi.fn(function createOverlayWindow() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const win = {
      handlers,
      setBounds: vi.fn(),
      isDestroyed: vi.fn(() => false),
      // Electron delivers 'closed' on a later tick, not from close() itself.
      close: vi.fn(() => {
        queueMicrotask(() => {
          win.isDestroyed.mockReturnValue(true);
          handlers.get('closed')?.();
        });
      }),
      isVisible: vi.fn(() => true),
      show: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      }),
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
      },
    };
    overlays.push(win as unknown as FakeWindow);
    return win;
  });

  return { MockBrowserWindow, overlays, parent };
});

vi.mock('electron', () => ({ BrowserWindow: MockBrowserWindow }));

vi.mock('../src/main/windows', () => ({
  buildViewUrl: (rendererUrl: string, query: string) => `${rendererUrl}?${query}`,
}));

import { ReconnectOverlay } from '../src/main/reconnectOverlay';

const parentBounds = { x: 0, y: 0, width: 800, height: 600 };

beforeEach(() => {
  overlays.length = 0;
  parent.handlers.clear();
  MockBrowserWindow.mockClear();
  parent.isDestroyed.mockReturnValue(false);
});

function makeOverlay() {
  return new ReconnectOverlay({
    parent: parent as never,
    preloadPath: '/preload.cjs',
    rendererUrl: 'file:///renderer/index.html',
  });
}

const flushPendingClose = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('ReconnectOverlay', () => {
  it('creates one overlay window when the connection starts waiting', () => {
    const overlay = makeOverlay();
    overlay.handleStatus('waiting');

    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
  });

  it('tracks the parent bounds while the overlay is open', () => {
    const overlay = makeOverlay();
    overlay.handleStatus('waiting');
    overlays[0].setBounds.mockClear();

    parent.emit('resize');

    expect(overlays[0].setBounds).toHaveBeenCalledWith(parentBounds);
  });

  it('stops tracking the parent once its own overlay has closed', async () => {
    const overlay = makeOverlay();
    overlay.handleStatus('waiting');
    overlay.handleStatus('connected');
    await flushPendingClose();
    overlays[0].setBounds.mockClear();

    parent.emit('resize');
    parent.emit('move');

    expect(overlays[0].setBounds).not.toHaveBeenCalled();
  });

  it('keeps the replacement overlay tracking the parent when the previous one closes late', async () => {
    const overlay = makeOverlay();
    overlay.handleStatus('waiting');
    overlay.handleStatus('connected');
    overlay.handleStatus('waiting');

    expect(overlays).toHaveLength(2);

    await flushPendingClose();
    overlays[1].setBounds.mockClear();

    parent.emit('resize');
    expect(overlays[1].setBounds).toHaveBeenCalledWith(parentBounds);

    overlays[1].setBounds.mockClear();
    parent.emit('move');
    expect(overlays[1].setBounds).toHaveBeenCalledWith(parentBounds);
  });

  it('leaves no parent listeners behind after the last overlay closes', async () => {
    const overlay = makeOverlay();
    overlay.handleStatus('waiting');
    overlay.handleStatus('connected');
    overlay.handleStatus('waiting');
    overlay.handleStatus('connected');
    await flushPendingClose();

    expect(parent.handlers.get('resize')).toHaveLength(0);
    expect(parent.handlers.get('move')).toHaveLength(0);
  });
});
