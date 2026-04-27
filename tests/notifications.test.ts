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

// Use a promise so the module is imported after mocking
const notificationsModule = import('../src/main/notifications');

beforeEach(() => {
  mockExecFile.mockReset();
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

describe('isOpenActionOutput', () => {
  it('only "open" (trimmed) activates window', async () => {
    const { isOpenActionOutput } = await notificationsModule;
    expect(isOpenActionOutput('open')).toBe(true);
    expect(isOpenActionOutput(' open \n')).toBe(true);
    expect(isOpenActionOutput('default')).toBe(false);
    expect(isOpenActionOutput('')).toBe(false);
  });
});

describe('showNotification', () => {
  it('calls notify-send with correct arguments', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());

    const notifySendCall = mockExecFile.mock.calls.find((c) => c[0] === 'notify-send');
    expect(notifySendCall).toBeDefined();
    const args = notifySendCall![1];
    expect(args).toEqual([
      '--app-name', 'WhatsApp',
      '--icon', '/icons/icon.png',
      '--wait',
      '-A', 'open=Open',
      '-A', 'dismiss=Dismiss',
      '--', 'Alice', 'Hello',
    ]);
  });

  it('calls onOpen when stdout is "open"', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, 'open\n', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not call onOpen when stdout is "dismiss"', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, 'dismiss\n', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not call onOpen when stdout is empty (timeout/body click)', async () => {
    const { showNotification } = await notificationsModule;
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, '', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not call onOpen on notify-send error', async () => {
    const { showNotification } = await notificationsModule;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') {
        cb(Object.assign(new Error('not found'), { code: 'ENOENT', killed: false, signal: null }), '', '');
      }
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
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
