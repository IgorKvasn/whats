# Notification Action Buttons

## Summary

Use D-Bus (`org.freedesktop.Notifications`) directly via `dbus-next` for desktop
notifications with "Open" and "Dismiss" action buttons. Falls back to plain
`notify-send` (no action buttons) when D-Bus is unavailable. Message
notifications use the sender profile image from WhatsApp's notification
payload when one is available.

## Motivation

Electron's `Notification` class does not support action buttons on Linux. The
initial approach used `notify-send --action`, but `notify-send` 0.8.6 routes
through the XDG Desktop Portal, which reports "Actions are not supported" even
when the underlying notification server (e.g. GNOME Shell) does support them.

Calling the `org.freedesktop.Notifications.Notify` D-Bus method directly
bypasses the portal and provides reliable action button support on all
freedesktop-compliant desktops.

## Design

### `showNotification` in `src/main/notifications.ts`

Uses `dbus-next` to connect to the session bus and call `Notify` with action
buttons:

```ts
import { sessionBus } from 'dbus-next';

const bus = sessionBus();
const obj = await bus.getProxyObject(
  'org.freedesktop.Notifications',
  '/org/freedesktop/Notifications',
);
const iface = obj.getInterface('org.freedesktop.Notifications');

const notificationId = await iface.Notify(
  'WhatsApp', 0, displayIconPath, sender, body,
  ['open', 'Open', 'dismiss', 'Dismiss'],
  {}, -1,
);

iface.on('ActionInvoked', (id, actionKey) => {
  if (id !== notificationId) return;
  iface.removeListener('ActionInvoked', handler);
  if (actionKey === 'open') onOpen();
});
```

For WhatsApp message notifications, the preload shim forwards `options.icon`,
`options.image`, or `options.badge` from `window.Notification` /
`ServiceWorkerRegistration.showNotification`. The main process resolves that
candidate to a local file path before calling `Notify`:

- `data:image/png|jpeg|webp;base64,...` icons are written to
  `<userData>/notification-icons`.
- `https://...` icons are fetched, content-type checked, capped at 2 MiB, and
  written to the same cache directory.
- Unsupported schemes, failed fetches, oversized images, and unknown content
  types fall back to the bundled app icon.

Cached sender icon files are removed after the notification lifecycle ends:
when an action is invoked, when `NotificationClosed` fires, when
`closeAllNotifications()` closes active notifications, or after the fallback
`notify-send` process returns. The fallback app icon is never deleted.

**Fallback:** If the D-Bus connection or `Notify` call fails, falls back to
plain `notify-send` without `-A` or `--wait` flags (shows a notification with
no action buttons), using the same sender icon path when available.

**Sound:** `paplay` via `execFile` remains unchanged and independent of the
notification mechanism.

### Removed code

- `isOpenActionOutput` — was only used to parse `notify-send` stdout; no longer
  needed with the D-Bus approach.

### Signature

```ts
showNotification(
  sender: string,
  body: string,
  withSound: boolean,
  iconPath: string,
  onOpen: () => void,
  senderIconPath?: string | null,
  cleanupIcon?: () => void | Promise<void>,
): void
```

`resolveNotificationIconPath()` converts a WhatsApp-provided icon candidate
into a D-Bus/notify-send-compatible local path. `removeCachedNotificationIcon()`
removes cached sender icon files and intentionally skips the fallback app icon.

### Callers in `src/main/index.ts`

All call sites pass `showMainWindow` as the `onOpen` callback and
`notificationIconPath` (computed from the icon directory) as `iconPath`:

- `whatsapp:notify` handler (message notifications), with sender icon
  resolution and cleanup
- `settings:preview-notification` handler
- `settings:preview-sound` handler
- `handleFailure` (update check failure notification)

### Notification behavior matrix

| User action              | Result                 |
|--------------------------|------------------------|
| Click "Open" button      | Show/focus main window |
| Click "Dismiss" button   | Dismiss (do nothing)   |
| Click notification body  | Dismiss (do nothing)   |
| Notification times out   | Nothing                |

All D-Bus close/action paths remove cached sender icon files for message
notifications. Fallback `notify-send` cleanup happens when the spawned command
returns because that path has no reliable dismissal signal.

### Build configuration

`dbus-next` must be listed in `rollupOptions.external` in `electron.vite.config.ts`
for both the main process build. The `externalizeDepsPlugin()` does not work
correctly with Vite 8 / Rolldown.

### Dependencies

- `dbus-next` (runtime, pure JS D-Bus client, ships own TypeScript types)

### Test changes

- Mock `dbus-next` with `vi.mock('dbus-next', ...)` providing a fake
  `sessionBus` that returns mock `getProxyObject` / `getInterface`.
- Test that `Notify` is called with correct args including actions array.
- Test `ActionInvoked` signal handling (open triggers `onOpen`, dismiss does
  not, wrong notification ID is ignored, listener is cleaned up).
- Test fallback to `notify-send` when D-Bus connection fails.
- `execFile` mock retained for `paplay` sound tests.
- Test sender icon forwarding, local cache creation, fallback behavior, and
  cached icon removal on notification action, close, explicit close-all, and
  direct removal helper calls.

## Out of scope

- Cross-platform support (macOS/Windows action buttons).
- Notification grouping or stacking.
- Custom notification sounds per contact.

## Status

**Implemented** — 2026-04-27. See commits `1c565bc` through `4ef6ab6`.
Sender profile icons and cached icon cleanup added in `d662414`.
