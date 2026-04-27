# Notification Action Buttons Implementation Plan

> **SUPERSEDED** — This plan was implemented but the `notify-send` approach
> didn't work (`notify-send` 0.8.6 routes through the XDG Desktop Portal which
> doesn't support actions). Replaced by
> `2026-04-27-dbus-notifications.md` which uses `dbus-next` instead.

**Goal:** Replace Electron's `Notification` with `notify-send` to add "Open" and "Dismiss" action buttons to desktop notifications.

**Architecture:** Spawn `notify-send` with `--wait` and `-A` action flags instead of using Electron's `Notification` class. Parse stdout to determine if the user clicked "Open" (triggers `showMainWindow`) or anything else (dismiss/timeout — do nothing). All four notification call sites use the same function.

**Tech Stack:** Electron (main process), `notify-send` CLI (freedesktop notifications), `execFile` from `node:child_process`, Vitest for tests.

---

### Task 1: Update `showNotification` in `src/main/notifications.ts`

**Files:**
- Modify: `src/main/notifications.ts`

- [ ] **Step 1: Update the `showNotification` function signature and implementation**

Replace the Electron `Notification` with `notify-send`. Remove the `Notification` import from electron. The file should look like this after the change:

```ts
import { execFile } from 'node:child_process';

const SOUND_FILE = '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga';

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

export function isOpenActionOutput(line: string): boolean {
  return line.trim() === 'open';
}

export function showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  iconPath: string,
  onOpen: () => void,
): void {
  const args = [
    '--app-name', 'WhatsApp',
    '--icon', iconPath,
    '--wait',
    '-A', 'open=Open',
    '-A', 'dismiss=Dismiss',
    '--', sender, body,
  ];

  execFile('notify-send', args, (err, stdout) => {
    if (err) {
      console.error('notify: notify-send failed:', err);
      return;
    }
    if (isOpenActionOutput(stdout)) {
      onOpen();
    }
  });

  if (withSound) {
    execFile('paplay', [SOUND_FILE], (err) => {
      if (err) console.error('notify: paplay failed:', err);
    });
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/notifications.ts
git commit -m "feat(notifications): replace electron Notification with notify-send action buttons"
```

---

### Task 2: Update callers in `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add `notificationIconPath` and update all `showNotification` calls**

At the top of `registerIpcHandlers`, compute the icon path and pass it to all four call sites.

In `registerIpcHandlers(iconDir: string)`, add this line at the top of the function body:

```ts
const notificationIconPath = path.join(iconDir, 'icon.png');
```

Update the four `showNotification` calls to include the new `iconPath` parameter:

1. `settings:preview-notification` handler (line ~134):
```ts
showNotification('WhatsApp', 'Notification preview', false, notificationIconPath, showMainWindow);
```

2. `settings:preview-sound` handler (line ~138):
```ts
showNotification('WhatsApp', 'Sound preview', true, notificationIconPath, showMainWindow);
```

3. `whatsapp:notify` handler (line ~181):
```ts
showNotification(senderTrunc, bodyText, settings.soundEnabled, notificationIconPath, showMainWindow);
```

4. `handleFailure` function (line ~274) — this one is outside `registerIpcHandlers`, so it needs access to `iconDir`. Hoist `notificationIconPath` to module scope by computing it after `iconDir` is available in `initialize()`:

Add a module-level variable:
```ts
let notificationIconPath = '';
```

In `initialize()`, after `iconDir` is computed (after line ~91):
```ts
notificationIconPath = path.join(iconDir, 'icon.png');
```

Remove the `const notificationIconPath` from inside `registerIpcHandlers` (it's now module-level).

Then update `handleFailure` (line ~274):
```ts
showNotification(
  'WhatsApp',
  "Couldn't check for updates — please verify your internet connection.",
  false,
  notificationIconPath,
  showMainWindow,
);
```

Also remove the `Notification` import if it was previously imported (it's not — `Notification` was only imported in `notifications.ts`, not in `index.ts`). No import changes needed in this file.

- [ ] **Step 2: Verify the file compiles**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(notifications): pass icon path to showNotification callers"
```

---

### Task 3: Update tests in `tests/notifications.test.ts`

**Files:**
- Modify: `tests/notifications.test.ts`

- [ ] **Step 1: Replace the Electron mock and add `showNotification` tests**

Replace the entire test file with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;

const mockExecFile = vi.fn<(cmd: string, args: string[], cb: ExecFileCallback) => void>();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...(args as Parameters<typeof mockExecFile>)),
}));

import {
  shouldDispatch,
  isSafeExternalUrl,
  isOpenActionOutput,
  showNotification,
} from '../src/main/notifications';

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('shouldDispatch', () => {
  it('dispatches on first call (no previous notification)', () => {
    expect(shouldDispatch(null, Date.now(), 'Alice', 'hi', 1500)).toBe(true);
  });

  it('skips same payload within dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(false);
  });

  it('dispatches same payload after dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 2000;
    expect(shouldDispatch(last, now, 'Alice', 'hi', 1500)).toBe(true);
  });

  it('dispatches different payload within dedup window', () => {
    const base = Date.now();
    const last = { time: base, sender: 'Alice', body: 'hi' };
    const now = base + 100;
    expect(shouldDispatch(last, now, 'Bob', 'hello', 1500)).toBe(true);
  });
});

describe('isSafeExternalUrl', () => {
  it('accepts web and contact schemes', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('HTTP://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isSafeExternalUrl('tel:+1234')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('ssh://host')).toBe(false);
    expect(isSafeExternalUrl('not-a-url')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });
});

describe('isOpenActionOutput', () => {
  it('only "open" (trimmed) activates window', () => {
    expect(isOpenActionOutput('open')).toBe(true);
    expect(isOpenActionOutput(' open \n')).toBe(true);
    expect(isOpenActionOutput('default')).toBe(false);
    expect(isOpenActionOutput('')).toBe(false);
  });
});

describe('showNotification', () => {
  it('calls notify-send with correct arguments', () => {
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

  it('calls onOpen when stdout is "open"', () => {
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, 'open\n', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not call onOpen when stdout is "dismiss"', () => {
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, 'dismiss\n', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not call onOpen when stdout is empty (timeout/body click)', () => {
    mockExecFile.mockImplementation((cmd, _args, cb) => {
      if (cmd === 'notify-send') cb(null, '', '');
    });

    const onOpen = vi.fn();
    showNotification('Alice', 'Hello', false, '/icons/icon.png', onOpen);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not call onOpen on notify-send error', () => {
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

  it('plays sound when withSound is true', () => {
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', true, '/icons/icon.png', vi.fn());

    const paplayCall = mockExecFile.mock.calls.find((c) => c[0] === 'paplay');
    expect(paplayCall).toBeDefined();
    expect(paplayCall![1]).toEqual(['/usr/share/sounds/freedesktop/stereo/message-new-instant.oga']);
  });

  it('does not play sound when withSound is false', () => {
    mockExecFile.mockImplementation((_cmd, _args, cb) => cb(null, '', ''));

    showNotification('Alice', 'Hello', false, '/icons/icon.png', vi.fn());

    const paplayCall = mockExecFile.mock.calls.find((c) => c[0] === 'paplay');
    expect(paplayCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/notifications.test.ts`
Expected: All 14 tests pass (4 shouldDispatch + 2 isSafeExternalUrl + 2 isOpenActionOutput + 6 showNotification).

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/notifications.test.ts
git commit -m "test(notifications): update tests for notify-send action buttons"
```
