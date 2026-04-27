# D-Bus Notification Action Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `notify-send` CLI with direct D-Bus calls via `dbus-next` so notification action buttons (Open/Dismiss) work on GNOME Shell and other compliant notification servers.

**Architecture:** The `showNotification` function in `src/main/notifications.ts` currently shells out to `notify-send` with `-A` flags. On GNOME Shell 49+, `notify-send` 0.8.6 routes through the XDG Desktop Portal which reports "Actions are not supported" even though the underlying `org.freedesktop.Notifications` D-Bus interface does support them. The fix is to call `org.freedesktop.Notifications.Notify` directly via `dbus-next`, then listen for `ActionInvoked` signals. Falls back to plain `notify-send` (no action buttons) if D-Bus is unavailable. The `paplay` sound call remains unchanged.

**Tech Stack:** `dbus-next` (pure JS D-Bus client, ships its own types), Electron main process, vitest for tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/notifications.ts` | Modify | Replace `execFile('notify-send', ...)` with D-Bus `Notify` call + `ActionInvoked` signal listener; remove `isOpenActionOutput` (dead code after this change) |
| `tests/notifications.test.ts` | Modify | Mock `dbus-next` instead of `child_process.execFile` for notification tests; keep `execFile` mock for `paplay` and fallback; remove `isOpenActionOutput` tests |
| `package.json` | Modify | Add `dbus-next` dependency |

---

### Task 1: Add `dbus-next` dependency

- [x] **Step 1: Install dbus-next**

Run: `yarn add dbus-next`

- [x] **Step 2: Verify it installed**

Run: `ls node_modules/dbus-next/types.d.ts`
Expected: file exists

- [x] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "build: add dbus-next for D-Bus notification support"
```

---

### Task 2: Write failing tests for D-Bus notification

The test file currently mocks `execFile` and checks that `notify-send` is called with action args. Replace those tests with ones that mock `dbus-next` and verify:
1. `Notify` is called with the correct D-Bus args (including actions array)
2. When `ActionInvoked` fires with `'open'`, `onOpen` is called
3. When `ActionInvoked` fires with `'dismiss'`, `onOpen` is NOT called
4. When D-Bus connection fails, it falls back to `notify-send` without actions (no `-A` flags, no `--wait`)
5. Sound (`paplay`) still works via `execFile`

**Important:** `dbus-next` uses named exports (`import { sessionBus } from 'dbus-next'`), not a default export. The mock must match. The implementation connects to D-Bus fresh each call (no caching) to keep things simple and testable.

**Files:**
- Modify: `tests/notifications.test.ts`

- [x] **Step 1: Rewrite `tests/notifications.test.ts`**

Replace the entire file with:

```typescript
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

const { mockNotifyCall, mockOnSignal, mockRemoveListener, mockGetProxyObject } = vi.hoisted(() => {
  const mockNotifyCall = vi.fn<(...args: unknown[]) => Promise<number>>();
  const mockOnSignal = vi.fn<(signal: string, handler: ActionInvokedHandler) => void>();
  const mockRemoveListener = vi.fn();
  const mockGetProxyObject = vi.fn();
  return { mockNotifyCall, mockOnSignal, mockRemoveListener, mockGetProxyObject };
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

beforeEach(() => {
  mockExecFile.mockReset();
  mockNotifyCall.mockReset();
  mockOnSignal.mockReset();
  mockRemoveListener.mockReset();
  mockGetProxyObject.mockReset();

  mockNotifyCall.mockResolvedValue(42);
  mockGetProxyObject.mockResolvedValue({
    getInterface: () => ({
      Notify: mockNotifyCall,
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/notifications.test.ts`
Expected: The `showNotification` tests should FAIL because the implementation still uses `execFile('notify-send', ...)` instead of D-Bus. The `shouldDispatch` and `isSafeExternalUrl` tests should still pass (unchanged logic).

- [x] **Step 3: Commit failing tests**

```bash
git add tests/notifications.test.ts
git commit -m "test(notifications): rewrite tests for D-Bus notification (red phase)"
```

---

### Task 3: Implement D-Bus notification with fallback

Replace the `showNotification` function to use `dbus-next` for sending notifications with action buttons via the `org.freedesktop.Notifications` D-Bus interface. Falls back to `notify-send` (without action buttons) if D-Bus connection fails. Remove `isOpenActionOutput` since it's dead code after this change (it was only used to parse `notify-send` stdout).

**Files:**
- Modify: `src/main/notifications.ts`

- [x] **Step 1: Rewrite `src/main/notifications.ts`**

Replace the entire file content with:

```typescript
import { execFile } from 'node:child_process';
import { sessionBus } from 'dbus-next';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';

const DBUS_DEST = 'org.freedesktop.Notifications';
const DBUS_PATH = '/org/freedesktop/Notifications';

export interface LastNotification {
  time: number;
  sender: string;
  body: string;
}

export function shouldDispatch(
  last: LastNotification | null,
  now: number,
  sender: string,
  body: string,
  windowMs: number,
): boolean {
  if (!last) return true;
  const samePayload = last.sender === sender && last.body === body;
  return !samePayload || now - last.time >= windowMs;
}

export function isSafeExternalUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const colonIdx = lower.indexOf(':');
  if (colonIdx < 1) return false;
  const scheme = lower.slice(0, colonIdx);
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
}

interface NotificationsInterface {
  Notify(
    appName: string,
    replacesId: number,
    icon: string,
    summary: string,
    body: string,
    actions: string[],
    hints: Record<string, unknown>,
    timeout: number,
  ): Promise<number>;
  on(signal: string, handler: (...args: unknown[]) => void): void;
  removeListener(signal: string, handler: (...args: unknown[]) => void): void;
}

function showNotificationFallback(
  sender: string,
  body: string,
  iconPath: string,
): void {
  const args = [
    '--app-name', 'WhatsApp',
    '--icon', iconPath,
    '--', sender, body,
  ];

  execFile('notify-send', args, (err) => {
    if (err) {
      console.error('notify: notify-send fallback failed:', err);
    }
  });
}

export function showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  iconPath: string,
  onOpen: () => void,
): void {
  const bus = sessionBus();

  bus.getProxyObject(DBUS_DEST, DBUS_PATH)
    .then((obj) => {
      const iface = obj.getInterface(DBUS_DEST) as unknown as NotificationsInterface;
      const actions = ['open', 'Open', 'dismiss', 'Dismiss'];

      return iface.Notify('WhatsApp', 0, iconPath, sender, body, actions, {}, -1)
        .then((notificationId) => {
          const handler = (id: number, actionKey: string): void => {
            if (id !== notificationId) return;
            iface.removeListener('ActionInvoked', handler);
            if (actionKey === 'open') {
              onOpen();
            }
          };
          iface.on('ActionInvoked', handler);
        });
    })
    .catch((err) => {
      console.error('notify: D-Bus notification failed, falling back to notify-send:', err);
      showNotificationFallback(sender, body, iconPath);
    });

  if (withSound) {
    execFile('paplay', [SOUND_FILE], (err) => {
      if (err) console.error('notify: paplay failed:', err);
    });
  }
}
```

- [x] **Step 2: Remove `isOpenActionOutput` from imports in `src/main/index.ts`**

In `src/main/index.ts`, line 8, change:

```typescript
import {
  shouldDispatch,
  showNotification,
  isSafeExternalUrl,
  type LastNotification,
} from './notifications';
```

to:

```typescript
import {
  shouldDispatch,
  showNotification,
  isSafeExternalUrl,
  type LastNotification,
} from './notifications';
```

(No change needed — `isOpenActionOutput` is not imported in `index.ts`. Verify with `rg isOpenActionOutput src/`.)

- [x] **Step 3: Run tests**

Run: `npx vitest run tests/notifications.test.ts`
Expected: All tests PASS.

- [x] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions).

- [x] **Step 5: Commit**

```bash
git add src/main/notifications.ts
git commit -m "feat(notifications): replace notify-send with D-Bus for action button support"
```

---

### Task 4: Manual verification — settings preview and real messages

Test the notification action buttons work end-to-end in the running app.

- [x] **Step 1: Build and run the app**

Run: `yarn dev`

- [x] **Step 2: Test settings notification preview**

1. Open Settings from the tray menu
2. Ensure "Show notifications" is checked
3. Click "Preview notification"
4. Verify a notification appears **with "Open" and "Dismiss" buttons**
5. Click "Open" — verify the app window comes to focus
6. Click "Preview notification" again
7. Click "Dismiss" — verify the notification closes without focusing the app

- [x] **Step 3: Test with a real WhatsApp message**

1. With the app running and minimized/unfocused
2. Send a message to yourself from another device
3. Verify the notification appears with action buttons
4. Click "Open" — verify the app window comes to focus

- [x] **Step 4: Test fallback (optional)**

Temporarily rename the `dbus-next` module dir to verify the fallback path sends a plain notification without action buttons via `notify-send`.
