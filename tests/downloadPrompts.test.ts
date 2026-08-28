import { describe, expect, it, vi, beforeEach } from 'vitest';

// @vitest-environment node

const { mockOpenChildWindow, mockShowItemInFolder, mockOpenPath, mockIsSafeToOpen, windows } = vi.hoisted(() => {
  const windows: Array<{
    handlers: Map<string, (...args: unknown[]) => void>;
    loadURL: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  }> = [];

  const mockOpenChildWindow = vi.fn(() => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const win = {
      handlers,
      loadURL: vi.fn(),
      close: vi.fn(() => {
        win.isDestroyed.mockReturnValue(true);
        handlers.get('closed')?.();
      }),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      }),
    };
    windows.push(win);
    return win;
  });

  return {
    mockOpenChildWindow,
    mockShowItemInFolder: vi.fn(),
    mockOpenPath: vi.fn(async () => ''),
    mockIsSafeToOpen: vi.fn(async () => true),
    windows,
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: {
    showItemInFolder: mockShowItemInFolder,
    openPath: mockOpenPath,
  },
}));

vi.mock('../src/main/executableClassifier', () => ({
  isSafeToOpen: mockIsSafeToOpen,
}));

vi.mock('../src/main/windows', () => ({
  openChildWindow: mockOpenChildWindow,
  buildViewUrl: (rendererUrl: string, query: string) => `${rendererUrl}?${query}`,
}));

import { DownloadPromptQueue } from '../src/main/downloadPrompts';

beforeEach(() => {
  windows.length = 0;
  mockOpenChildWindow.mockClear();
  mockShowItemInFolder.mockClear();
  mockOpenPath.mockClear();
  mockOpenPath.mockResolvedValue('');
  mockIsSafeToOpen.mockClear();
  mockIsSafeToOpen.mockResolvedValue(true);
});

describe('DownloadPromptQueue', () => {
  function makeQueue() {
    return new DownloadPromptQueue('/preload.cjs', 'file:///renderer/index.html');
  }

  it('opens one window immediately for a single enqueued prompt', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });

    expect(mockOpenChildWindow).toHaveBeenCalledTimes(1);
  });

  it('queues a second prompt instead of opening it immediately', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });

    expect(mockOpenChildWindow).toHaveBeenCalledTimes(1);
  });

  it('shows the next prompt once the previous window closes', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });

    expect(mockOpenChildWindow).toHaveBeenCalledTimes(1);
    windows[0].close();
    expect(mockOpenChildWindow).toHaveBeenCalledTimes(2);
  });

  it('every enqueued prompt eventually gets its own window', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });
    queue.enqueue({ filename: 'c.pdf', filePath: '/tmp/c.pdf', canOpen: true });

    windows[0].close();
    windows[1].close();

    expect(mockOpenChildWindow).toHaveBeenCalledTimes(3);
  });

  it('dismiss closes the window and advances the queue', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });

    queue.dismiss('download-1');

    expect(windows[0].close).toHaveBeenCalled();
    expect(mockOpenChildWindow).toHaveBeenCalledTimes(2);
  });

  it('reveal shows the file in the folder and closes its own prompt', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });

    queue.reveal('download-1');

    expect(mockShowItemInFolder).toHaveBeenCalledWith('/tmp/a.pdf');
    expect(windows[0].close).toHaveBeenCalled();
  });

  it('open launches the file via shell.openPath for its own prompt', async () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });

    await queue.open('download-1');

    expect(mockOpenPath).toHaveBeenCalledWith('/tmp/a.pdf');
    expect(windows[0].close).toHaveBeenCalled();
  });

  it('surfaces a failure to open the file', async () => {
    mockOpenPath.mockResolvedValue('no application found');
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });

    await expect(queue.open('download-1')).rejects.toThrow('no application found');
  });

  it('keeps the prompt window open when opening fails, so the error stays visible', async () => {
    mockOpenPath.mockResolvedValue('no application found');
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });

    await expect(queue.open('download-1')).rejects.toThrow('no application found');

    expect(windows[0].close).not.toHaveBeenCalled();
  });

  it('refuses to open a prompt whose file was classified unsafe at download time', async () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.sh', filePath: '/tmp/a.sh', canOpen: false });

    await expect(queue.open('download-1')).rejects.toThrow('not safe to open');

    expect(mockOpenPath).not.toHaveBeenCalled();
    expect(windows[0].close).not.toHaveBeenCalled();
  });

  it('refuses to open a file that became unsafe after it was enqueued', async () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    mockIsSafeToOpen.mockResolvedValue(false);

    await expect(queue.open('download-1')).rejects.toThrow('not safe to open');

    expect(mockIsSafeToOpen).toHaveBeenCalledWith('/tmp/a.pdf');
    expect(mockOpenPath).not.toHaveBeenCalled();
  });

  it('getInfo returns the info for a still-pending prompt', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: false });

    expect(queue.getInfo('download-2')).toEqual({
      id: 'download-2',
      filename: 'b.pdf',
      filePath: '/tmp/b.pdf',
      canOpen: false,
    });
  });

  it('assigns each enqueued prompt a unique id', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });

    expect(queue.getInfo('download-1')?.filename).toBe('a.pdf');
    expect(queue.getInfo('download-2')?.filename).toBe('b.pdf');
  });

  it('acts on its own file, not whichever download finished most recently', () => {
    const queue = makeQueue();
    queue.enqueue({ filename: 'a.pdf', filePath: '/tmp/a.pdf', canOpen: true });
    queue.enqueue({ filename: 'b.pdf', filePath: '/tmp/b.pdf', canOpen: true });

    queue.reveal('download-1');

    expect(mockShowItemInFolder).toHaveBeenCalledWith('/tmp/a.pdf');
    expect(mockShowItemInFolder).not.toHaveBeenCalledWith('/tmp/b.pdf');
  });
});
